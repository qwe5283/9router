"use client";

import { useEffect, useState } from "react";
import { Button } from "@/shared/components";
import {
  DASHBOARD_LOGIN_METHOD_LABELS,
  DASHBOARD_LOGIN_REASON_LABELS,
} from "@/shared/constants/dashboardLogin";

export default function LoginHistory() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/settings/login-history", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load login history");
        const data = await response.json();
        if (!controller.signal.aborted) setEvents(data.events);
      } catch {
        if (!controller.signal.aborted) setError("Failed to load login history");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadHistory();
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-medium text-sm sm:text-base">Recent dashboard logins</h4>
          <p className="mt-1 text-xs text-text-muted">
            Latest 20 sign-in attempts. Times are shown in your local time zone.
          </p>
          <p className="text-xs text-text-muted">Up to 1,000 records are retained.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon="refresh"
          loading={loading}
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="text-xs sm:text-sm text-red-500">{error}</p>
        ) : loading && events.length === 0 ? (
          <p className="text-xs sm:text-sm text-text-muted">Loading login history...</p>
        ) : events.length === 0 ? (
          <p className="text-xs sm:text-sm text-text-muted">No dashboard login records yet.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-border" aria-busy={loading}>
            <table className="w-full text-left text-xs sm:text-sm">
              <caption className="sr-only">Recent dashboard logins</caption>
              <thead className="sticky top-0 z-10 bg-surface-2 text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2 font-medium">Method</th>
                  <th scope="col" className="px-3 py-2 font-medium">IP</th>
                  <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">User-Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {events.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <time dateTime={event.timestamp} title={event.timestamp} data-i18n-skip="true">
                        <span className="block">{new Date(event.timestamp).toLocaleDateString()}</span>
                        <span className="block mt-0.5 text-xs text-text-muted">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </time>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${event.success ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                        {event.success ? "Success" : "Failed"}
                      </span>
                      {!event.success && event.reason && (
                        <p className="mt-1 min-w-24 max-w-36 text-xs text-text-muted">
                          {DASHBOARD_LOGIN_REASON_LABELS[event.reason] || "Login could not be completed"}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {DASHBOARD_LOGIN_METHOD_LABELS[event.method] || event.method}
                    </td>
                    <td className="px-3 py-3 font-mono whitespace-nowrap" data-i18n-skip="true">{event.ip}</td>
                    <td className="px-3 py-3">
                      {event.userAgent ? (
                        <details className="w-32 sm:w-40">
                          <summary className="cursor-pointer" title={event.userAgent}>
                            <span className="inline-block max-w-24 sm:max-w-32 truncate align-bottom" data-i18n-skip="true">
                              {event.userAgent}
                            </span>
                          </summary>
                          <p className="mt-2 break-all text-xs text-text-muted" data-i18n-skip="true">{event.userAgent}</p>
                        </details>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
