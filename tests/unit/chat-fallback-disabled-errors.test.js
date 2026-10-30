import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const state = vi.hoisted(() => ({
  connections: [],
  fallbackEnabled: false,
  execute: vi.fn(),
  update: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({
    providerOverrides: {
      "openai-compatible-test": { fallbackEnabled: state.fallbackEnabled },
      "anthropic-compatible-test": { fallbackEnabled: state.fallbackEnabled },
    },
  }),
  getProviderConnections: async ({ provider, isActive } = {}) => state.connections
    .filter((c) => (!provider || c.provider === provider) && (isActive === undefined || c.isActive === isActive)),
  updateProviderConnection: state.update,
  validateApiKey: vi.fn(),
  getProxyPools: async () => [],
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (name) => {
    const [provider, model] = name.split("/");
    return { provider, model };
  },
  getComboModels: async () => null,
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: async () => null,
  enforceKeyAccess: async () => null,
  filterAdapterModels: async (_key, models) => models,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: state.execute }),
}));
vi.mock("open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("open-sse/utils/debugLog.js", () => ({ dbg: vi.fn(), isDebugEnabled: false }));
vi.mock("@/sse/utils/logger.js", async (importOriginal) => ({
  ...await importOriginal(),
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  tagForSession: vi.fn(() => "test"), line: vi.fn(), errorLine: vi.fn(),
}));

const { handleChat } = await import("@/sse/handlers/chat.js");

beforeEach(() => {
  vi.clearAllMocks();
  state.update.mockReset();
  state.execute.mockReset();
  state.fallbackEnabled = false;
  state.connections = ["openai-compatible-test", "anthropic-compatible-test"].map((provider) => ({
    id: `${provider}-connection`, provider, authType: "apikey", apiKey: "test-key",
    name: "Test", isActive: true, testStatus: "active",
    providerSpecificData: { baseUrl: "https://upstream.test/v1", apiType: "chat" },
  }));
  state.update.mockImplementation(async (id, patch) => {
    const connection = state.connections.find((c) => c.id === id);
    Object.assign(connection, patch);
    return connection;
  });
});

const chat = (provider = "openai-compatible-test", stream = false) => handleChat(new Request("https://router.test/v1/chat/completions", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: `${provider}/test-model`, stream, messages: [{ role: "user", content: "hello" }] }),
}));

describe("chat connection errors with fallback disabled", () => {
  it.each(["openai-compatible-test", "anthropic-compatible-test"])("%s records an HTTP error while preserving the original response", async (provider) => {
    const raw = '{ "error": { "message": "quota exhausted", "vendor_field": 42 } }\n';
    state.execute.mockResolvedValueOnce({
      response: new Response(raw, { status: 429, headers: { "content-type": "application/json", "retry-after": "37" } }),
    });

    const response = await chat(provider);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(await response.text()).toBe(raw);
    expect(state.execute).toHaveBeenCalledOnce();
    expect(state.connections.find((c) => c.provider === provider)).toMatchObject({
      lastError: expect.stringContaining("quota exhausted"),
      errorCode: 429,
      lastErrorAt: expect.any(String),
    });
    expect(state.update).toHaveBeenCalledOnce();
    expect(Object.keys(state.update.mock.calls[0][1]).some((key) => key.startsWith("modelLock_") || key === "backoffLevel")).toBe(false);
  });

  it.each([400, 401, 403, 502, 503])("records HTTP %s without introducing a cooldown", async (status) => {
    const raw = `upstream diagnostic (${status})`;
    state.execute.mockImplementation(async () => ({ response: new Response(raw, { status, headers: { "content-type": "text/plain" } }) }));
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await (await chat()).text()).toBe(raw);
    }
    expect(state.execute).toHaveBeenCalledTimes(2);
    expect(state.connections[0]).toMatchObject({ testStatus: "error", lastError: raw, errorCode: status });
    expect(Object.keys(state.connections[0]).some((key) => key.startsWith("modelLock_"))).toBe(false);
  });

  it("records network failures", async () => {
    state.execute.mockRejectedValueOnce(new Error("connection reset by upstream"));
    expect((await chat()).status).toBe(502);
    expect(state.connections[0]).toMatchObject({ lastError: expect.stringContaining("connection reset by upstream"), errorCode: 502 });
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it("clears the recorded error on the next successful request", async () => {
    state.execute.mockResolvedValueOnce({ response: new Response("quota exhausted", { status: 429 }) });
    await (await chat()).text();
    expect(state.connections[0].lastError).toBe("quota exhausted");
    state.execute.mockResolvedValueOnce({ response: new Response('{"ok":true}', { headers: { "content-type": "application/json" } }) });
    expect(await (await chat()).text()).toBe('{"ok":true}');
    await vi.waitFor(() => expect(state.connections[0]).toMatchObject({ testStatus: "active", lastError: null, errorCode: null, lastErrorAt: null }));
  });

  it("still returns the raw error if persisting the diagnostic fails", async () => {
    const raw = '{"error":{"message":"quota exhausted"}}';
    state.execute.mockResolvedValueOnce({ response: new Response(raw, { status: 429 }) });
    state.update.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await chat();
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(raw);
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it("preserves bodyless upstream responses", async () => {
    state.execute.mockResolvedValueOnce({ response: new Response(null, { status: 304 }) });
    const response = await chat();
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(state.connections[0].errorCode).toBe(304);
  });

  it("limits the saved diagnostic to 200 characters without truncating the client response", async () => {
    const message = "x".repeat(300);
    const raw = JSON.stringify({ error: { message } });
    state.execute.mockResolvedValueOnce({ response: new Response(raw, { status: 503 }) });
    expect(await (await chat()).text()).toBe(raw);
    expect(state.connections[0].lastError).toBe(message.slice(0, 200));
  });

  it.each([
    'event: error\ndata: {"error":{"message":"blocked by upstream","status":403}}\n\n',
    'data: {"type":"response.failed","response":{"error":{"message":"blocked by upstream","status":403}}}\n\n',
    'event: error\ndata: blocked by upstream\n\n',
    'event: error\r\ndata: {"message":\r\ndata: "blocked by upstream", "status":403}\r\n\r\n',
    'data: {"error":"blocked by upstream"}',
  ])("records a late SSE error while forwarding every byte: %s", async (errorEvent) => {
    const raw = 'data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n' + errorEvent;
    const bytes = new TextEncoder().encode(raw);
    state.execute.mockResolvedValueOnce({ response: new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 73));
      controller.enqueue(bytes.slice(73));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }) });
    const response = await chat("openai-compatible-test", true);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(raw);
    expect(state.connections[0]).toMatchObject({ testStatus: "error", lastError: "blocked by upstream", lastErrorAt: expect.any(String) });
    expect(state.execute).toHaveBeenCalledOnce();
    expect(Object.keys(state.connections[0]).some((key) => key.startsWith("modelLock_"))).toBe(false);
  });

  it("does not record ordinary SSE extension events as errors", async () => {
    const raw = 'event: vendor.custom\ndata: {"message":"diagnostic extension"}\n\ndata: [DONE]\n\n';
    state.execute.mockResolvedValueOnce({ response: new Response(raw, { headers: { "content-type": "text/event-stream" } }) });
    expect(await (await chat("openai-compatible-test", true)).text()).toBe(raw);
    expect(state.connections[0].lastError).toBeUndefined();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("keeps the detailed SSE diagnostic for an HTTP error response", async () => {
    const raw = 'event: error\ndata: {"error":{"message":"specific vendor failure","status":429}}\n\n';
    state.execute.mockResolvedValueOnce({ response: new Response(raw, { status: 429, headers: { "content-type": "text/event-stream" } }) });
    const response = await chat("openai-compatible-test", true);
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(raw);
    expect(state.connections[0]).toMatchObject({ lastError: "specific vendor failure", errorCode: 429 });
  });

  it("records an upstream stream disconnect without retrying", async () => {
    let sent = false;
    state.execute.mockResolvedValueOnce({ response: new Response(new ReadableStream({
      pull(controller) {
        if (sent) controller.error(new Error("upstream connection reset"));
        else {
          sent = true;
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        }
      },
    }), { headers: { "content-type": "text/event-stream" } }) });
    const response = await chat("openai-compatible-test", true);
    await expect(response.text()).rejects.toThrow("upstream connection reset");
    await vi.waitFor(() => expect(state.connections[0]).toMatchObject({ testStatus: "error", lastError: "upstream connection reset", errorCode: 502 }));
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it("keeps normal account cooldown behavior when fallback is enabled", async () => {
    state.fallbackEnabled = true;
    state.execute.mockResolvedValueOnce({ response: new Response('{"error":{"message":"quota exhausted"}}', { status: 429 }) });
    expect((await chat()).status).toBe(503);
    expect(state.connections[0]).toMatchObject({ testStatus: "unavailable", errorCode: 429 });
    expect(state.connections[0]["modelLock_test-model"]).toBeTruthy();
  });
});
