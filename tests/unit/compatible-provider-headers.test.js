import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
const { GithubExecutor } = await import("../../open-sse/executors/github.js");
const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");

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

  it.each(["openai-compatible-chat-test", "anthropic-compatible-test", "claude", "codex"])("%s uses the original client User-Agent ahead of configured headers", async (provider) => {
    const executor = provider === "codex" ? new CodexExecutor() : new DefaultExecutor(provider);
    const result = await executor.execute({
      model: "test-model", body: { model: "test-model", input: "hello", messages: [{ role: "user", content: "hello" }] }, stream: false,
      credentials: {
        apiKey: "upstream-key", accessToken: "upstream-token", providerSpecificData: { baseUrl: "https://upstream.test/v1" },
        rawHeaders: { "uSeR-aGeNt": "original-client/3.0", "x-client-only": "private", authorization: "Bearer client-key" },
      },
      providerOverrides: { headers: { "USER-AGENT": "configured-agent/1.0", "X-Custom": "kept" }, useClientUserAgent: true },
    });
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("user-agent")).toBe("original-client/3.0");
    expect(headers.get("x-custom")).toBe("kept");
    expect(headers.has("x-client-only")).toBe(false);
    expect(headers.get("authorization")).not.toBe("Bearer client-key");
    expect(Object.keys(fetchMock.mock.calls[0][1].headers).filter(k => k.toLowerCase() === "user-agent")).toHaveLength(1);
    await result.response.text();
  });

  it.each([false, undefined])("keeps configured User-Agent when reuse is %s", async (useClientUserAgent) => {
    await new DefaultExecutor("openai-compatible-chat-test").execute({
      model: "test-model", body: { model: "test-model", messages: [] }, stream: false,
      credentials: { apiKey: "upstream-key", rawHeaders: { "user-agent": "original-client/3.0" } },
      providerOverrides: { headers: { "User-Agent": "configured-agent/1.0" }, useClientUserAgent },
    });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("user-agent")).toBe("configured-agent/1.0");
  });

  it("falls back to configured User-Agent when the client does not provide one", async () => {
    await new DefaultExecutor("openai-compatible-chat-test").execute({
      model: "test-model", body: { model: "test-model", messages: [] }, stream: false,
      credentials: { apiKey: "upstream-key", rawHeaders: {} },
      providerOverrides: { headers: { "User-Agent": "configured-agent/1.0" }, useClientUserAgent: true },
    });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("user-agent")).toBe("configured-agent/1.0");
  });

  it.each(["github", "cursor"])("applies User-Agent policy on the dedicated %s transport", (provider) => {
    const executor = provider === "github" ? new GithubExecutor() : new CursorExecutor();
    const credentials = {
      accessToken: "upstream-token", providerSpecificData: { machineId: "test-machine-id" },
      rawHeaders: { "user-agent": "original-client/3.0" },
      providerOverrides: { headers: { "USER-AGENT": "configured-agent/1.0" }, useClientUserAgent: true },
    };
    expect(new Headers(executor.buildHeaders(credentials)).get("user-agent")).toBe("original-client/3.0");
    credentials.providerOverrides.useClientUserAgent = false;
    expect(new Headers(executor.buildHeaders(credentials)).get("user-agent")).toBe("configured-agent/1.0");
  });
});
