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
    expect(await response.json()).toEqual({ passthrough: true, headers: { "X-Gateway": "test" } });
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
});
