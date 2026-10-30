import { describe, expect, it, vi } from "vitest";
import { disableResponseFallback } from "../../open-sse/utils/responsePolicy.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: vi.fn(), warn: vi.fn() };
const successBody = '{"choices":[{"message":{"content":"served by next model"}}]}';
const success = () => new Response(successBody, { headers: { "content-type": "application/json" } });

describe("combo fallback is independent of provider fallback", () => {
  it.each([400, 401, 429, 503])("tries the next model after HTTP %s with provider fallback disabled", async (status) => {
    const originalBody = '{ "error": { "message": "original upstream failure", "vendor_field": 42 } }\n';
    const response = disableResponseFallback(new Response(originalBody, { status, headers: { "content-type": "application/json" } }));
    const next = success();
    const handleSingleModel = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(next);
    const result = await handleComboChat({
      body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel,
      log, comboStrategy: "fallback",
    });
    expect(result).toBe(next);
    expect(await result.text()).toBe(successBody);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual(["gateway/first", "gateway/second"]);
  });

  it("tries the next model after an error-only SSE response", async () => {
    const originalBody = 'event: error\ndata: {"type":"error","error":{"message":"original"}}\n\ndata: non-JSON upstream diagnostic\n\n';
    const response = disableResponseFallback(new Response(originalBody, { headers: { "content-type": "text/event-stream" } }));
    const next = success();
    const handleSingleModel = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(next);
    const result = await handleComboChat({
      body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel,
      log, comboStrategy: "fallback",
    });
    expect(result).toBe(next);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("tries the next model after empty JSON content", async () => {
    const response = disableResponseFallback(new Response('{"choices":[{"message":{"content":""}}]}', { headers: { "content-type": "application/json" } }));
    const next = success();
    const handleSingleModel = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(next);
    expect(await handleComboChat({ body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel, log })).toBe(next);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("continues through mixed provider settings", async () => {
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"first failed"}}', { status: 503 }))
      .mockResolvedValueOnce(disableResponseFallback(new Response('{"error":{"message":"second failed"}}', { status: 429 })))
      .mockResolvedValueOnce(success());
    const models = ["gateway/first", "gateway/second", "gateway/third"];
    const result = await handleComboChat({ body: {}, models, handleSingleModel, log });
    expect(await result.text()).toBe(successBody);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual(models);
  });

  it("tries every model when all providers have fallback disabled", async () => {
    const handleSingleModel = vi.fn(() => Promise.resolve(disableResponseFallback(new Response('{"error":{"message":"unavailable"}}', { status: 503 }))));
    const result = await handleComboChat({ body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel, log });
    expect(result.status).toBe(503);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("returns a successful response without trying another model", async () => {
    const response = disableResponseFallback(success());
    const handleSingleModel = vi.fn().mockResolvedValue(response);
    const result = await handleComboChat({ body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel, log });
    expect(result).toBe(response);
    expect(await result.text()).toBe(successBody);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it("does not switch after streaming usable content, even if a later error arrives", async () => {
    const raw = 'data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\nevent: error\ndata: {"error":{"message":"late failure"}}\n\n';
    const handleSingleModel = vi.fn().mockResolvedValue(disableResponseFallback(new Response(raw, { headers: { "content-type": "text/event-stream" } })));
    const result = await handleComboChat({ body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel, log });
    expect(await result.text()).toBe(raw);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 503])("preserves single-member Combo HTTP %s responses", async (status) => {
    const raw = '{ "error": { "message": "original upstream failure" } }\n';
    const response = disableResponseFallback(new Response(raw, { status, headers: { "content-type": "application/json", "retry-after": "37" } }));
    const handleSingleModel = vi.fn().mockResolvedValue(response);
    const result = await handleComboChat({ body: {}, models: ["gateway/only"], handleSingleModel, log });
    expect(result).toBe(response);
    expect(result.status).toBe(status);
    expect(result.headers.get("retry-after")).toBe("37");
    expect(await result.text()).toBe(raw);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it("preserves single-member Combo SSE without pre-reading", async () => {
    const raw = 'event: error\ndata: {"error":{"message":"original failure"}}\n\n';
    const response = disableResponseFallback(new Response(raw, { headers: { "content-type": "text/event-stream" } }));
    const getReader = vi.spyOn(response.body, "getReader");
    const handleSingleModel = vi.fn().mockResolvedValue(response);
    const result = await handleComboChat({ body: {}, models: ["gateway/only"], handleSingleModel, log });
    expect(result).toBe(response);
    expect(getReader).not.toHaveBeenCalled();
    expect(await result.text()).toBe(raw);
  });

  it("does not let a nested single-member Combo stop its parent's fallback", async () => {
    const failure = disableResponseFallback(new Response('{"error":{"message":"nested failed"}}', { status: 429 }));
    const nested = () => handleComboChat({ body: {}, models: ["gateway/only"], handleSingleModel: async () => failure, log });
    const handleSingleModel = vi.fn(async (_body, model) => model === "nested" ? nested() : success());
    const result = await handleComboChat({ body: {}, models: ["nested", "gateway/next"], handleSingleModel, log });
    expect(await result.text()).toBe(successBody);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual(["nested", "gateway/next"]);
  });
});
