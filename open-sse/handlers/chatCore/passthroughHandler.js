import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { extractUsage, mergeUsage } from "../../utils/usageTracking.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";
import { SSE_HEADERS_CORS } from "../../utils/sseConstants.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";

// Observe usage without parsing/re-serializing the bytes sent back to the client.
export async function handlePassthroughResponse({ providerResponse, provider, model, body, stream, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, streamController, trackDone, appendLog, reqTag, log }) {
  const success = providerResponse.ok;
  if (success && onRequestSuccess) Promise.resolve().then(onRequestSuccess).catch(() => {});
  const contentType = providerResponse.headers.get("content-type") || "application/json";
  const isSSE = contentType.toLowerCase().includes("text/event-stream");
  const headers = {
    ...(isSSE ? SSE_HEADERS_CORS : { "Access-Control-Allow-Origin": "*" }),
    ...upstreamResponseHeaders(providerResponse.headers),
    "Content-Type": contentType,
  };

  const complete = (usage, responseBody, ttftAt) => {
    const latency = { ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime, total: Date.now() - requestStartTime };
    trackDone();
    appendLog({ status: success ? "SUCCESS" : `FAILED ${providerResponse.status}` });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId, latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody,
      providerResponse: responseBody,
      response: { type: isSSE ? "streaming" : "passthrough" },
      status: success ? "success" : "error",
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));
  };

  if (!isSSE) {
    const hasBody = providerResponse.body !== null;
    try {
      const bytes = await providerResponse.arrayBuffer();
      let responseBody = null;
      try { responseBody = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* non-JSON bodies remain unchanged */ }
      complete(extractUsageFromResponse(responseBody), responseBody, null);
      return { success, status: providerResponse.status, response: new Response(hasBody ? bytes : null, { status: providerResponse.status, statusText: providerResponse.statusText, headers }) };
    } catch (error) {
      trackDone();
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, error.message || "Failed to read upstream response");
    } finally {
      streamController.handleComplete();
    }
  }

  let usage = null;
  let pending = "";
  let ttftAt = null;
  const decoder = new TextDecoder();
  const observeLine = (line) => {
    if (!line.startsWith("data:")) return;
    try {
      usage = mergeUsage(usage, extractUsage(JSON.parse(line.slice(5).trim())));
    } catch { /* extensions and [DONE] do not affect forwarding */ }
  };
  const observer = new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) observeLine(line);
      controller.enqueue(chunk);
    },
    flush() {
      observeLine(pending + decoder.decode());
      complete(usage, "[Passthrough stream]", ttftAt);
    },
  });
  return {
    success,
    status: providerResponse.status,
    response: new Response(pipeWithDisconnect(providerResponse, observer, streamController), { status: providerResponse.status, statusText: providerResponse.statusText, headers }),
  };
}
