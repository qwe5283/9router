import { saveDashboardLoginEvent } from "@/lib/db/repos/dashboardLoginEventsRepo";
import { getClientIp } from "./loginLimiter";

export async function recordDashboardLogin(request, { method, success = false, reason = null }) {
  try {
    // Only store request metadata and fixed reason codes, never credentials,
    // tokens, assertions, or raw errors from an identity provider.
    await saveDashboardLoginEvent({
      method,
      success,
      reason,
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent") || "",
    });
  } catch {
    // Audit storage must not change the outcome of authentication.
    console.error("[Dashboard login history] Failed to save login event");
  }
}
