import { describe, expect, it, vi } from "vitest";
import { disableResponseFallback } from "../../open-sse/utils/responsePolicy.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo respects a provider with fallback disabled", () => {
  it.each([401, 429, 503])("returns the original HTTP %s response without trying another model", async (status) => {
    const originalBody = '{ "error": { "message": "original upstream failure", "vendor_field": 42 } }\n';
    const response = disableResponseFallback(new Response(originalBody, { status, headers: { "content-type": "application/json" } }));
    const handleSingleModel = vi.fn().mockResolvedValue(response);
    const result = await handleComboChat({
      body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() }, comboStrategy: "fallback",
    });
    expect(result).toBe(response);
    expect(await result.text()).toBe(originalBody);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it("skips SSE pre-reading and preserves an error-only stream", async () => {
    const originalBody = 'event: error\ndata: {"type":"error","error":{"message":"original"}}\n\ndata: non-JSON upstream diagnostic\n\n';
    const response = disableResponseFallback(new Response(originalBody, { headers: { "content-type": "text/event-stream" } }));
    const getReader = vi.spyOn(response.body, "getReader");
    const handleSingleModel = vi.fn().mockResolvedValue(response);
    const result = await handleComboChat({
      body: {}, models: ["gateway/first", "gateway/second"], handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() }, comboStrategy: "fallback",
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(await result.text()).toBe(originalBody);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });
});
