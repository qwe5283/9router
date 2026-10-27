import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { executeMock, fetchMock } = vi.hoisted(() => ({ executeMock: vi.fn(), fetchMock: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: executeMock }) }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { saveRequestUsage } = await import("@/lib/usageDb.js");

const original = {
  model: "gateway/test-model", stream: false,
  system: [{ type: "text", text: "keep the original system", cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
  tools: [{ name: "duplicate", input_schema: { type: "object" } }, { name: "duplicate", input_schema: { type: "object" } }],
  response_format: { type: "json_schema", json_schema: { name: "test", schema: { type: "object" } } },
  thinking: { type: "adaptive", custom: true },
  vendor_extension: { nested: [1, 2, { keep: true }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async () => new Response('{"ok":true,"usage":{"prompt_tokens":7,"completion_tokens":2}}', {
    status: 200, headers: { "content-type": "application/json" },
  }));
  executeMock.mockImplementation(async (args) => new DefaultExecutor(args.credentials.provider).execute(args));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected compression or image download"); }));
});
afterEach(() => vi.unstubAllGlobals());

function options(provider, raw = original, passthrough = true) {
  return {
    body: { ...structuredClone(raw), model: `${provider}/test-model` },
    modelInfo: { provider, model: "test-model" },
    credentials: { provider, apiKey: "test-key", providerSpecificData: { baseUrl: "https://upstream.test/v1", apiType: "responses" } },
    providerOverrides: { passthrough, headers: { "X-Custom": "from-dashboard" } },
    clientRawRequest: { body: structuredClone(raw), endpoint: "/v1/messages", headers: { "user-agent": "claude-code/test", accept: "application/json" } },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    providerThinking: { mode: "high" }, rtkEnabled: true, headroomEnabled: true, headroomUrl: "https://compress.test",
    cavemanEnabled: true, cavemanLevel: "full", ponytailEnabled: true, ponytailLevel: "full",
    customPromptEnabled: true, customPrompt: "must not be injected", pxpipeEnabled: true,
    connectionId: "test-connection",
  };
}

describe("manual provider request passthrough", () => {
  it.each(["openai-compatible-responses-test", "anthropic-compatible-test"])("%s forwards every original field and only changes model", async (provider) => {
    const opts = options(provider);
    const rawBefore = structuredClone(opts.clientRawRequest.body);
    const onRequestSuccess = vi.fn();
    const result = await handleChatCore({ ...opts, onRequestSuccess });
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(provider.startsWith("anthropic") ? "https://upstream.test/v1/messages" : "https://upstream.test/v1/responses");
    expect(JSON.parse(init.body)).toEqual({ ...rawBefore, model: "test-model" });
    expect(new Headers(init.headers).get("x-custom")).toBe("from-dashboard");
    expect(opts.clientRawRequest.body).toEqual(rawBefore);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await result.response.text()).toBe('{"ok":true,"usage":{"prompt_tokens":7,"completion_tokens":2}}');
    expect(onRequestSuccess).toHaveBeenCalledOnce();
    expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ prompt_tokens: 7, completion_tokens: 2 }) }));
  });

  it("keeps missing stream and protocol-specific fields unchanged", async () => {
    const raw = { model: "gateway/test-model", input: "hello", store: true, include: ["reasoning.encrypted_content"], previous_response_id: "resp-before" };
    const opts = options("openai-compatible-responses-test", raw);
    await handleChatCore(opts);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...raw, model: "test-model" });
  });

  it("passes SSE bytes and extension events through unchanged", async () => {
    const event = 'event: vendor.custom\ndata: {"extension":"你好"}\n\ndata: {"usage":{"prompt_tokens":9,"completion_tokens":3}}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(event);
    fetchMock.mockImplementationOnce(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(bytes.slice(0, 52)); c.enqueue(bytes.slice(52)); c.close();
    } }), { headers: { "content-type": "text/event-stream" } }));
    const result = await handleChatCore(options("openai-compatible-chat-test", { ...original, stream: true }));
    expect(await result.response.text()).toBe(event);
    expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ prompt_tokens: 9, completion_tokens: 3 }) }));
  });

  it("returns upstream errors to the existing account fallback path", async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { "retry-after": "30" } }));
    const result = await handleChatCore(options("openai-compatible-chat-test"));
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("30");
  });

  it("keeps normal translation and executor transforms when passthrough is off", async () => {
    const provider = "openai-compatible-chat-test";
    const opts = options(provider, original, false);
    Object.assign(opts, { rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false, customPromptEnabled: false, pxpipeEnabled: false });
    opts.credentials.providerSpecificData.apiType = "chat";
    const result = await handleChatCore(opts);
    expect(result.success).toBe(true);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).not.toEqual({ ...original, model: "test-model" });
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("x-custom")).toBe("from-dashboard");
    await result.response.text();
  });
});
