import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { normalizeProviderId } from "../../src/lib/providerNormalization.js";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnectionById: mocks.getProviderConnectionById,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));

import { POST as validateProvider } from "../../src/app/api/providers/validate/route.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { GET as listProviderModels } from "../../src/app/api/providers/[id]/models/route.js";

const jsonResponse = (body = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Agnes CN provider identity", () => {
  it("keeps both provider IDs, aliases and model catalogues distinct", () => {
    for (const prefix of ["agnes", "agnes-ai"]) {
      expect(parseModel(`${prefix}/agnes-2.5-flash`).provider).toBe("agnes");
    }
    for (const prefix of ["agnes-cn", "agnes-ai-cn"]) {
      expect(parseModel(`${prefix}/agnes-2.5-flash`).provider).toBe("agnes-cn");
    }
    expect(normalizeProviderId("Agnes AI CN")).toBe("agnes-cn");
    expect(AI_PROVIDERS["agnes-cn"].name).toBe("Agnes AI CN");
    expect(AI_PROVIDERS["agnes-cn"].website).toBe("https://agnes-ai.cn");
    expect(AI_PROVIDERS["agnes-cn"].notice.apiKeyUrl).toBe("https://platform.agnes-ai.cn");
    expect(PROVIDER_MODELS["agnes-cn"]).toEqual(PROVIDER_MODELS.agnes);
  });

  it("reuses the Agnes brand icon on routes that load icons by provider ID", () => {
    expect(readFileSync(new URL("../../public/providers/agnes-cn.png", import.meta.url)))
      .toEqual(readFileSync(new URL("../../public/providers/agnes.png", import.meta.url)));
  });
});

describe.each([
  { provider: "agnes", domain: "agnes-ai.com" },
  { provider: "agnes-cn", domain: "agnes-ai.cn" },
])("$provider chat and connection routes", ({ provider, domain }) => {
  const apiBase = `https://apihub.${domain}/v1`;
  const connectionId = `${provider}-connection`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse()));
    mocks.getProviderConnectionById.mockResolvedValue({
      id: connectionId,
      provider,
      authType: "apikey",
      apiKey: "test-key",
      providerSpecificData: {},
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends chat requests to this provider's own domain", async () => {
    const body = { model: "agnes-2.5-flash", messages: [{ role: "user", content: "Hello" }], stream: false };
    const payload = { choices: [{ message: { role: "assistant", content: "Hello" } }] };
    global.fetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await getExecutor(provider).execute({
      model: body.model,
      body,
      stream: false,
      credentials: { apiKey: "test-key" },
      proxyOptions: {},
      directFetch: global.fetch,
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(`${apiBase}/chat/completions`);
    expect(options.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(options.body)).toMatchObject(body);
    expect(await result.response.json()).toEqual(payload);
  });

  it.each([200, 401])("validates a new API key using the correct domain (HTTP %s)", async (status) => {
    global.fetch.mockResolvedValueOnce(jsonResponse({}, status));
    const response = await validateProvider(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: "test-key" }),
    }));

    expect((await response.json()).valid).toBe(status === 200);
    expect(global.fetch).toHaveBeenCalledWith(`${apiBase}/models`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it.each([200, 401])("tests saved connections using the correct domain (HTTP %s)", async (status) => {
    global.fetch.mockResolvedValueOnce(jsonResponse({}, status));
    const result = await testSingleConnection(connectionId);

    expect(result.valid).toBe(status === 200);
    expect(global.fetch).toHaveBeenCalledWith(`${apiBase}/models`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
      testStatus: status === 200 ? "active" : "error",
    }));
  });

  it("discovers models with this provider's own credentials and domain", async () => {
    const models = [{ id: "agnes-2.5-flash" }, { id: "agnes-image-2.5-flash" }];
    global.fetch.mockResolvedValueOnce(jsonResponse({ data: models }));

    const response = await listProviderModels(
      new Request(`http://localhost/api/providers/${connectionId}/models`),
      { params: Promise.resolve({ id: connectionId }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider, connectionId, models });
    expect(global.fetch).toHaveBeenCalledWith(`${apiBase}/models`, expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });
});
