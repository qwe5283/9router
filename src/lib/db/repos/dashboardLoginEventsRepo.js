import { getAdapter } from "../driver.js";
import {
  DASHBOARD_LOGIN_HISTORY_LIMIT,
  DASHBOARD_LOGIN_HISTORY_MAX_RECORDS,
} from "@/shared/constants/dashboardLogin";

export async function saveDashboardLoginEvent({ method, success, ip, userAgent, reason }) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(
      `INSERT INTO dashboardLoginEvents(timestamp, method, success, ip, userAgent, reason) VALUES(?, ?, ?, ?, ?, ?)`,
      [new Date().toISOString(), method, success ? 1 : 0, String(ip || "unknown").slice(0, 128), String(userAgent || "").slice(0, 2048), reason || null]
    );
    db.run(
      `DELETE FROM dashboardLoginEvents WHERE id IN (SELECT id FROM dashboardLoginEvents ORDER BY timestamp DESC, id DESC LIMIT -1 OFFSET ?)`,
      [DASHBOARD_LOGIN_HISTORY_MAX_RECORDS]
    );
  });
}

export async function getDashboardLoginEvents() {
  const db = await getAdapter();
  return db.all(
    `SELECT id, timestamp, method, success, ip, userAgent, reason FROM dashboardLoginEvents ORDER BY timestamp DESC, id DESC LIMIT ?`,
    [DASHBOARD_LOGIN_HISTORY_LIMIT]
  ).map((row) => ({ ...row, success: row.success === 1 }));
}
