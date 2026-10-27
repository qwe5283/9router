import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async () => Response.json({ ok: true }));
});

describe("compatible provider custom headers", () => {
  it("adds custom headers and replaces defaults regardless of header-name casing", async () => {
    const executor = new DefaultExecutor("anthropic-compatible-test");
    const result = await executor.execute({
      model: "test-model",
      body: { model: "test-model", messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials: { apiKey: "test-key", providerSpecificData: { baseUrl: "https://upstream.test/v1" } },
      providerOverrides: { headers: { "Anthropic-Version": "custom-version", "X-Custom": "from-dashboard" } },
    });

    expect(result.response.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://upstream.test/v1/messages");
    const headers = new Headers(init.headers);
    expect(headers.get("anthropic-version")).toBe("custom-version");
    expect(headers.get("x-custom")).toBe("from-dashboard");
  });
});
