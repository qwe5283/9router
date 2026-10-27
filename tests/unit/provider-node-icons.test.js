import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getProviderIconOptions, normalizeProviderNodeIconId } from "@/lib/providerIcons";
import { getProviderNodeDefaultIconId, getProviderNodeIconSrc } from "@/shared/utils/providerIcon";

const originalDataDir = process.env.DATA_DIR;
let tempDir, POST, PUT, GET, getProviderNodeById, createProviderConnection, getProviderConnectionById, getAdapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-icons-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
  ({ POST, GET } = await import("@/app/api/provider-nodes/route.js"));
  ({ PUT } = await import("@/app/api/provider-nodes/[id]/route.js"));
  ({ getProviderNodeById, createProviderConnection, getProviderConnectionById } = await import("@/models/index.js"));
  ({ getAdapter } = await import("@/lib/db/driver.js"));
});

afterAll(async () => {
  try {
    if (getAdapter) (await getAdapter()).close();
    if (tempDir) {
      const resolved = path.resolve(tempDir);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("9router-provider-icons-")) {
        throw new Error("Refusing to remove a directory outside this test's temporary workspace");
      }
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    vi.doUnmock("next/server");
  }
});

const request = (body, method = "POST") => new Request("http://localhost/api/provider-nodes", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const fields = (type = "openai-compatible") => ({
  name: "Avatar test", prefix: "avatar-test", type, apiType: "chat", baseUrl: "https://upstream.test/v1",
});

describe("provider avatar catalog", () => {
  it("lists unique existing assets with names and local image paths", () => {
    const icons = getProviderIconOptions();
    expect(icons.length).toBeGreaterThan(20);
    expect(new Set(icons.map((icon) => icon.id)).size).toBe(icons.length);
    for (const icon of icons) {
      expect(icon.name).toBeTruthy();
      expect(icon.src).toMatch(/^\/providers\/[a-z0-9-]+\.png$/);
      expect(fs.existsSync(path.join(process.cwd(), "public", icon.src))).toBe(true);
    }
  });

  it("normalizes aliases and supports clearing or omitting the custom selection", () => {
    expect(normalizeProviderNodeIconId(" Gemini-Web ")).toEqual({ iconId: "gemini" });
    expect(normalizeProviderNodeIconId(null)).toEqual({ iconId: null });
    expect(normalizeProviderNodeIconId(undefined)).toEqual({ iconId: undefined });
    expect(getProviderNodeDefaultIconId({ type: "openai-compatible", apiType: "responses" })).toBe("oai-r");
    expect(getProviderNodeIconSrc({ type: "anthropic-compatible" })).toBe("/providers/anthropic-m.png");
    expect(getProviderNodeIconSrc({ type: "openai-compatible", iconId: "gemini" })).toBe("/providers/gemini.png");
  });
});

describe("provider-node avatar persistence", () => {
  it.each(["openai-compatible", "anthropic-compatible", "custom-embedding"])("stores a selected avatar for %s nodes", async (type) => {
    const response = await POST(request({ ...fields(type), iconId: "gemini" }));
    expect(response.status).toBe(201);
    const { node } = await response.json();
    expect((await getProviderNodeById(node.id)).iconId).toBe("gemini");
    expect((await (await GET()).json()).nodes.find((entry) => entry.id === node.id).iconId).toBe("gemini");
  });

  it("updates and resets avatars, preserving legacy edits and connection credentials", async () => {
    const { node } = await (await POST(request({ ...fields(), iconId: "gemini" }))).json();
    const connection = await createProviderConnection({ provider: node.id, authType: "apikey", name: "Avatar test connection", apiKey: "test-key", providerSpecificData: { custom: "kept" } });
    const params = { params: Promise.resolve({ id: node.id }) };
    const saved = await PUT(request({ ...fields(), iconId: "deepseek" }, "PUT"), params);
    expect(saved.status).toBe(200);
    expect((await getProviderNodeById(node.id)).iconId).toBe("deepseek");
    expect(await getProviderConnectionById(connection.id)).toMatchObject({ apiKey: "test-key", providerSpecificData: { custom: "kept" } });
    await PUT(request(fields(), "PUT"), params);
    expect((await getProviderNodeById(node.id)).iconId).toBe("deepseek");
    await PUT(request({ ...fields(), iconId: null }, "PUT"), params);
    expect((await getProviderNodeById(node.id)).iconId).toBeNull();
    expect(getProviderNodeIconSrc(await getProviderNodeById(node.id))).toBe("/providers/oai-cc.png");
  });

  it.each(["../.env", "https://example.test/image.png", "not-an-existing-avatar", 1, ["gemini"]])("rejects an invalid avatar %j before changing storage", async (iconId) => {
    const before = (await (await GET()).json()).nodes.length;
    expect((await POST(request({ ...fields(), iconId }))).status).toBe(400);
    expect((await (await GET()).json()).nodes).toHaveLength(before);
  });
});
