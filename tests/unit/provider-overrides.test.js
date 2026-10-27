import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: { providerOverrides: {} } }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => Response.json(body, init) },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => state.settings,
  updateSettings: async (updates) => { Object.assign(state.settings, updates); },
}));

const { GET, PUT } = await import("@/app/api/providers/[id]/overrides/route.js");
const provider = "openai-compatible-chat-test";
const params = { params: Promise.resolve({ id: provider }) };
const put = (body, context = params) => PUT(new Request("http://localhost/api/providers/test/overrides", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), context);

beforeEach(() => { state.settings = { providerOverrides: {} }; });

describe("compatible provider overrides", () => {
  it("saves headers and passthrough independently, including clearing each field", async () => {
    expect((await put({ headers: { "X-Custom": "value" } })).status).toBe(200);
    expect((await put({ passthrough: true })).status).toBe(200);
    expect(await (await GET(null, params)).json()).toMatchObject({ headers: { "X-Custom": "value" }, passthrough: true });
    await put({ headers: {} });
    expect(state.settings.providerOverrides[provider]).toEqual({ passthrough: true });
    await put({ headers: { "X-Other": "kept" } });
    await put({ passthrough: false });
    expect(state.settings.providerOverrides[provider]).toEqual({ headers: { "X-Other": "kept" } });
    await put({});
    expect(state.settings.providerOverrides[provider]).toBeUndefined();
  });

  it("supports Anthropic-compatible nodes as well", async () => {
    const response = await put({ passthrough: true, headers: { "X-Gateway": "test" } }, { params: Promise.resolve({ id: "anthropic-compatible-test" }) });
    expect(await response.json()).toEqual({ passthrough: true, fallbackEnabled: true, useClientUserAgent: false, headers: { "X-Gateway": "test" } });
  });

  it.each(["true", 1, null])("rejects a non-boolean passthrough value %j", async (passthrough) => {
    expect((await put({ passthrough })).status).toBe(400);
    expect(state.settings.providerOverrides).toEqual({});
  });

  it("does not enable passthrough for built-in providers", async () => {
    expect((await put({ passthrough: true }, { params: Promise.resolve({ id: "codex" }) })).status).toBe(400);
  });

  it("retains header validation while passthrough is enabled", async () => {
    await put({ passthrough: true });
    expect((await put({ headers: { Authorization: "replaced" } })).status).toBe(400);
    expect((await put({ headers: { "X-Custom": "bad\r\nvalue" } })).status).toBe(400);
    expect(state.settings.providerOverrides[provider]).toEqual({ passthrough: true });
  });

  it("enables fallback by default and saves it without overwriting headers or passthrough", async () => {
    expect(await (await GET(null, params)).json()).toMatchObject({ fallbackEnabled: true });
    await put({ headers: { "X-Custom": "kept" }, passthrough: true });
    expect(await (await put({ fallbackEnabled: false })).json()).toEqual({
      headers: { "X-Custom": "kept" }, passthrough: true, fallbackEnabled: false, useClientUserAgent: false,
    });
    await put({ headers: { "X-Custom": "updated" } });
    await put({ passthrough: false });
    expect(await (await GET(null, params)).json()).toMatchObject({ headers: { "X-Custom": "updated" }, passthrough: false, fallbackEnabled: false });
    await put({ fallbackEnabled: true });
    expect(state.settings.providerOverrides[provider]).toEqual({ headers: { "X-Custom": "updated" } });
  });

  it.each(["false", 0, null])("rejects non-boolean fallbackEnabled %j", async (fallbackEnabled) => {
    expect((await put({ fallbackEnabled })).status).toBe(400);
    expect(state.settings.providerOverrides).toEqual({});
  });

  it("does not disable fallback for built-in providers", async () => {
    expect((await put({ fallbackEnabled: false }, { params: Promise.resolve({ id: "codex" }) })).status).toBe(400);
  });

  it("disables client User-Agent reuse by default and preserves all other overrides", async () => {
    expect(await (await GET(null, params)).json()).toMatchObject({ useClientUserAgent: false });
    await put({ headers: { "User-Agent": "configured-agent" }, passthrough: true, fallbackEnabled: false });
    expect(await (await put({ useClientUserAgent: true })).json()).toMatchObject({
      headers: { "User-Agent": "configured-agent" }, passthrough: true, fallbackEnabled: false, useClientUserAgent: true,
    });
    await put({ headers: { "User-Agent": "updated-agent" } });
    expect(await (await GET(null, params)).json()).toMatchObject({ useClientUserAgent: true });
    await put({ useClientUserAgent: false });
    expect(state.settings.providerOverrides[provider]).toEqual({ headers: { "User-Agent": "updated-agent" }, passthrough: true, fallbackEnabled: false });
  });

  it("supports client User-Agent reuse for built-in providers with Custom Headers", async () => {
    const context = { params: Promise.resolve({ id: "codex" }) };
    expect((await put({ useClientUserAgent: true }, context)).status).toBe(200);
    expect(await (await GET(null, context)).json()).toMatchObject({ useClientUserAgent: true });
  });

  it.each(["true", 1, null])("rejects non-boolean useClientUserAgent %j", async (useClientUserAgent) => {
    expect((await put({ useClientUserAgent })).status).toBe(400);
    expect(state.settings.providerOverrides).toEqual({});
  });
});
