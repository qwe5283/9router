import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getProvidersByKind } from "../../src/shared/constants/providers.js";
import { GET as getModelInfo } from "../../src/app/api/v1/models/info/route.js";

const MODEL = "agnes-image-2.5-flash";
const RESPONSE = { created: 1780000000, data: [{ url: "https://example.com/generated.png", b64_json: null }] };
const jsonResponse = (body = RESPONSE, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function generate(body = {}, options = {}) {
  return handleImageGenerationCore({
    body: { model: `agnes/${MODEL}`, prompt: "日出时分的浮空城市", ...body },
    modelInfo: { provider: "agnes", model: MODEL },
    credentials: { apiKey: "agnes-test-key" },
    ...options,
  });
}

const upstreamBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

describe("Agnes image generation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is selectable in the dashboard and publishes image metadata", async () => {
    expect(getProvidersByKind("image").map((provider) => provider.id)).toContain("agnes");
    expect(getProvidersByKind("llm").map((provider) => provider.id)).toContain("agnes");
    expect(PROVIDER_MODELS.agnes.filter((model) => model.kind !== "image")).toHaveLength(4);

    const response = await getModelInfo(new Request(`http://localhost/v1/models/info?id=agnes/${MODEL}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: `agnes/${MODEL}`,
      kind: "image",
      endpoint: "/v1/images/generations",
      capabilities: ["text2img", "edit"],
      params: ["size", "ratio", "response_format"],
      options: {
        size: ["1K", "2K", "3K", "4K"],
        ratio: ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"],
      },
    });
  });

  it("sends documented defaults and authenticates with the existing API key", async () => {
    const onRequestSuccess = vi.fn();
    const result = await generate({}, { onRequestSuccess });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://apihub.agnes-ai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer agnes-test-key" },
      })
    );
    expect(upstreamBody()).toEqual({
      model: MODEL,
      prompt: "日出时分的浮空城市",
      size: "1K",
      ratio: "1:1",
      extra_body: { response_format: "url" },
    });
    expect(await result.response.json()).toEqual(RESPONSE);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("translates dashboard defaults without forwarding unsupported OpenAI controls", async () => {
    await generate({ size: "auto", n: 1, quality: "auto", background: "transparent", output_format: "png", watermark: true });
    expect(upstreamBody()).toEqual({
      model: MODEL,
      prompt: "日出时分的浮空城市",
      size: "1K",
      ratio: "1:1",
      extra_body: { response_format: "url" },
    });
  });

  it("preserves a requested tier and ratio", async () => {
    await generate({ size: "2K", ratio: "16:9" });
    expect(upstreamBody()).toMatchObject({ size: "2K", ratio: "16:9" });
  });

  it("passes legacy pixel sizes without imposing a square ratio", async () => {
    await generate({ size: "1024x768" });
    expect(upstreamBody().size).toBe("1024x768");
    expect(upstreamBody()).not.toHaveProperty("ratio");
  });

  it.each([
    { response_format: "b64_json" },
    { return_base64: true },
    { extra_body: { response_format: "b64_json" } },
  ])("requests text-to-image Base64 using the documented wire fields: %j", async (body) => {
    const response = { created: 1780000000, data: [{ url: null, b64_json: "aW1hZ2U=" }] };
    global.fetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await generate(body);
    expect(result.success).toBe(true);
    expect(upstreamBody()).not.toHaveProperty("response_format");
    expect(upstreamBody()).toMatchObject({ return_base64: true, extra_body: { response_format: "b64_json" } });
    expect(await result.response.json()).toEqual(response);
  });

  it.each([
    { image: "https://example.com/input.png" },
    { image: ["https://example.com/input.png", "data:image/png;base64,aW1hZ2U="] },
    { extra_body: { image: ["https://example.com/input.png", "data:image/png;base64,aW1hZ2U="] } },
  ])("nests reference images for edits and multi-image composition: %j", async (body) => {
    await generate({ ...body, response_format: "b64_json", tags: ["img2img"] });
    const source = body.extra_body?.image ?? body.image;
    expect(upstreamBody().extra_body).toEqual({
      image: Array.isArray(source) ? source : [source],
      response_format: "b64_json",
    });
    for (const field of ["image", "tags", "response_format", "return_base64"]) {
      expect(upstreamBody()).not.toHaveProperty(field);
    }
  });

  it("decodes Base64 through the existing binary output path", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    global.fetch.mockResolvedValueOnce(jsonResponse({ created: 1780000000, data: [{ b64_json: bytes.toString("base64") }] }));
    const result = await generate({ response_format: "b64_json" }, { binaryOutput: true });

    expect(result.success).toBe(true);
    expect(Buffer.from(await result.response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    [{ n: 2 }, "one image per request"],
    [{ size: "5K" }, "size must be"],
    [{ ratio: "5:4" }, "ratio must be"],
    [{ image: [] }, "image must contain"],
    [{ image: [null] }, "image must contain"],
    [{ response_format: "png" }, "response_format must be"],
  ])("rejects an unsupported request before calling Agnes: %j", async (body, message) => {
    const result = await generate(body);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain(message);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports upstream errors without returning a successful empty image", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: { message: "Image quota exceeded" } }, 429));
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("Image quota exceeded");
    expect(global.fetch).toHaveBeenCalledOnce();
  });
});
