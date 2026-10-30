import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { extractUsage, mergeUsage } from "../../utils/usageTracking.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";
import { SSE_ERROR_EVENT, SSE_HEADERS_CORS } from "../../utils/sseConstants.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { createErrorResult, parseUpstreamError } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { DEFAULT_ERROR_MESSAGES } from "../../config/errorConfig.js";
import { RESPONSES_EVENT } from "../../translator/schema/index.js";

// Observe usage and errors without re-serializing the bytes sent back to the client.
export async function handlePassthroughResponse({ providerResponse, provider, model, body, stream, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, onRequestError, streamController, trackDone, appendLog, reqTag, log }) {
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
      const error = success ? undefined : (await parseUpstreamError(new Response(hasBody ? bytes : null, { status: providerResponse.status }))).message;
      complete(extractUsageFromResponse(responseBody), responseBody, null);
      return { success, status: providerResponse.status, error, response: new Response(hasBody ? bytes : null, { status: providerResponse.status, statusText: providerResponse.statusText, headers }) };
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
  let eventType = "";
  let eventData = [];
  const decoder = new TextDecoder();
  const observeEvent = async () => {
    const data = eventData.join("\n");
    const type = eventType;
    eventType = "";
    eventData = [];
    if (!data) return;
    let parsed;
    try {
      parsed = JSON.parse(data);
      usage = mergeUsage(usage, extractUsage(parsed));
    } catch { /* extensions and [DONE] do not affect forwarding */ }
    if (!onRequestError) return;
    const error = parsed?.error || parsed?.response?.error;
    if (!error && type !== SSE_ERROR_EVENT && type !== RESPONSES_EVENT.FAILED && parsed?.type !== SSE_ERROR_EVENT && parsed?.type !== RESPONSES_EVENT.FAILED) return;
    const detail = error || parsed || data;
    const status = Number(detail.status || parsed?.status);
    const message = typeof detail === "string" ? detail : detail.message || JSON.stringify(detail);
    await onRequestError(status >= 400 && status < 600 ? status : HTTP_STATUS.BAD_GATEWAY, message);
  };
  const observeLine = async (line) => {
    line = line.replace(/\r$/, "");
    if (!line) await observeEvent();
    else if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /, ""));
  };
  const observer = new TransformStream({
    async transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) await observeLine(line);
      controller.enqueue(chunk);
    },
    async flush() {
      await observeLine(pending + decoder.decode());
      await observeEvent();
      complete(usage, "[Passthrough stream]", ttftAt);
    },
  });
  return {
    success,
    status: providerResponse.status,
    error: success ? undefined : DEFAULT_ERROR_MESSAGES[providerResponse.status] || `Upstream error: ${providerResponse.status}`,
    response: new Response(pipeWithDisconnect(providerResponse, observer, streamController), { status: providerResponse.status, statusText: providerResponse.statusText, headers }),
  };
}
