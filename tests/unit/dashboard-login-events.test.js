import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-login-events-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.restoreAllMocks();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir && path.dirname(path.resolve(tempDir)) === path.resolve(os.tmpdir())) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dashboard login event storage", () => {
  it("persists metadata and boolean results across database restarts", async () => {
    const { saveDashboardLoginEvent } = await import("@/lib/db/repos/dashboardLoginEventsRepo");
    const started = new Date().toISOString();
    await saveDashboardLoginEvent({
      method: "password", success: false, reason: "invalid_password",
      ip: "203.0.113.9", userAgent: "Browser/1.0",
    });
    await saveDashboardLoginEvent({ method: "oidc", success: true, ip: "::1", userAgent: "Browser/2.0" });
    global._dbAdapter.instance.close();
    delete global._dbAdapter;
    vi.resetModules();

    const { getDashboardLoginEvents } = await import("@/lib/db/repos/dashboardLoginEventsRepo");
    const events = await getDashboardLoginEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ method: "oidc", success: true, ip: "::1", reason: null });
    expect(events[1]).toMatchObject({
      method: "password", success: false, reason: "invalid_password",
      ip: "203.0.113.9", userAgent: "Browser/1.0",
    });
    expect(events[1].timestamp >= started).toBe(true);
  });

  it("keeps only the newest 1,000 events and returns the latest 20 with stable ordering", async () => {
    const { getAdapter } = await import("@/lib/db/driver");
    const { saveDashboardLoginEvent, getDashboardLoginEvents } = await import("@/lib/db/repos/dashboardLoginEventsRepo");
    const db = await getAdapter();
    db.transaction(() => {
      for (let i = 0; i < 1001; i++) {
        db.run(
          `INSERT INTO dashboardLoginEvents(timestamp, method, success, ip, userAgent) VALUES(?, ?, ?, ?, ?)`,
          ["2020-01-01T00:00:00.000Z", "password", 0, "unknown", `Browser/${i}`]
        );
      }
    });
    await saveDashboardLoginEvent({ method: "saml", success: true, userAgent: "Latest" });

    expect(db.get(`SELECT COUNT(*) AS count FROM dashboardLoginEvents`).count).toBe(1000);
    expect(db.get(`SELECT MIN(id) AS id FROM dashboardLoginEvents`).id).toBe(3);
    const events = await getDashboardLoginEvents();
    expect(events).toHaveLength(20);
    expect(events[0]).toMatchObject({ id: 1002, method: "saml", success: true, userAgent: "Latest" });
    expect(events.map((event) => event.id)).toEqual(Array.from({ length: 20 }, (_, i) => 1002 - i));
  });

  it("bounds untrusted metadata and supplies values for missing headers", async () => {
    const { saveDashboardLoginEvent, getDashboardLoginEvents } = await import("@/lib/db/repos/dashboardLoginEventsRepo");
    await saveDashboardLoginEvent({ method: "password", success: false });
    await saveDashboardLoginEvent({ method: "password", success: false, ip: "x".repeat(500), userAgent: "a".repeat(5000) });
    const events = await getDashboardLoginEvents();
    expect(events[0].ip).toHaveLength(128);
    expect(events[0].userAgent).toHaveLength(2048);
    expect(events[1]).toMatchObject({ ip: "unknown", userAgent: "" });
  });

  it("adds the login table when upgrading an existing database without losing settings", async () => {
    const { getAdapter } = await import("@/lib/db/driver");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, ['{"requireLogin":true}']);
    db.exec(`DROP TABLE dashboardLoginEvents`);
    db.run(`UPDATE _meta SET value = '2' WHERE key = 'backupSchemaVersion'`);
    db.close();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: restart } = await import("@/lib/db/driver");
    const upgraded = await restart();
    expect(upgraded.all(`SELECT * FROM dashboardLoginEvents`)).toEqual([]);
    expect(JSON.parse(upgraded.get(`SELECT data FROM settings WHERE id = 1`).data)).toEqual({ requireLogin: true });
    expect(upgraded.get(`SELECT value FROM _meta WHERE key = 'backupSchemaVersion'`).value).toBe("3");
    expect(fs.readdirSync(path.join(tempDir, "db", "backups")).some((name) => name.includes("schema-2-to-3"))).toBe(true);
  });
});
