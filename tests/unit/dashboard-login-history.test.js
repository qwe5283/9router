import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveDashboardLoginEvent: vi.fn(),
  getDashboardLoginEvents: vi.fn(),
}));

vi.mock("@/lib/db/repos/dashboardLoginEventsRepo", () => mocks);

const { recordDashboardLogin } = await import("@/lib/auth/loginHistory");
const { GET } = await import("../../src/app/api/settings/login-history/route.js");

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe("dashboard login history", () => {
  it("records trusted peer IP and User-Agent without capturing credentials", async () => {
    vi.stubEnv("NINEROUTER_PEER_TOKEN", "proof");
    const request = new Request("http://localhost/api/auth/login", {
      headers: {
        "x-9r-peer-token": "proof", "x-9r-real-ip": "203.0.113.4",
        "user-agent": "TestBrowser/1.0", authorization: "secret", cookie: "auth_token=secret",
      },
    });
    await recordDashboardLogin(request, { method: "password", success: false, reason: "invalid_password" });
    expect(mocks.saveDashboardLoginEvent).toHaveBeenCalledWith({
      method: "password", success: false, reason: "invalid_password", ip: "203.0.113.4", userAgent: "TestBrowser/1.0",
    });
  });

  it("does not accept forged peer or forwarded IP headers", async () => {
    vi.stubEnv("NINEROUTER_PEER_TOKEN", "proof");
    vi.stubEnv("TRUST_PROXY", "false");
    await recordDashboardLogin(new Request("http://localhost", {
      headers: { "x-9r-real-ip": "203.0.113.4", "x-forwarded-for": "203.0.113.4" },
    }), { method: "oidc", success: true });
    expect(mocks.saveDashboardLoginEvent).toHaveBeenCalledWith(expect.objectContaining({ ip: "unknown" }));
  });

  it("does not interrupt authentication or leak raw database errors when logging fails", async () => {
    mocks.saveDashboardLoginEvent.mockRejectedValue(new Error("secret database details"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordDashboardLogin(new Request("http://localhost"), { method: "saml", success: true })).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith("[Dashboard login history] Failed to save login event");
    errorLog.mockRestore();
  });

  it("serves login history without caching", async () => {
    mocks.getDashboardLoginEvents.mockResolvedValue([{ id: 1, success: true }]);
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ events: [{ id: 1, success: true }] });
  });

  it("returns a generic uncached error when history cannot be read", async () => {
    mocks.getDashboardLoginEvents.mockRejectedValue(new Error("secret database details"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Failed to load login history" });
  });
});
