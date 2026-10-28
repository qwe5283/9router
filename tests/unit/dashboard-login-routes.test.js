import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), compare: vi.fn(), cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(), recordDashboardLogin: vi.fn(),
  isLocalRequest: vi.fn(), checkLock: vi.fn(), recordFail: vi.fn(), recordSuccess: vi.fn(), getClientIp: vi.fn(),
  isOidcConfigured: vi.fn(), isSamlConfigured: vi.fn(),
  getOidcRuntimeConfig: vi.fn(), fetchOidcDiscovery: vi.fn(), exchangeOidcCode: vi.fn(), verifyOidcIdToken: vi.fn(),
  validateSamlResponse: vi.fn(), buildSamlAuthorizeUrl: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  shouldUseSecureCookie: () => false,
}));
vi.mock("@/lib/auth/loginHistory", () => ({ recordDashboardLogin: mocks.recordDashboardLogin }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock, recordFail: mocks.recordFail, recordSuccess: mocks.recordSuccess, getClientIp: mocks.getClientIp,
}));
vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
  getOidcRuntimeConfig: mocks.getOidcRuntimeConfig,
  fetchOidcDiscovery: mocks.fetchOidcDiscovery,
  exchangeOidcCode: mocks.exchangeOidcCode,
  verifyOidcIdToken: mocks.verifyOidcIdToken,
  getPublicOrigin: () => "http://localhost",
  pickOidcEmail: () => "user@example.com",
  pickOidcDisplayName: () => "User",
  buildOidcAuthorizationUrl: () => "https://idp.example.com/authorize",
  createOidcState: () => "state",
  createOidcNonce: () => "nonce",
  createPkcePair: () => ({ verifier: "verifier", challenge: "challenge" }),
}));
vi.mock("@/lib/auth/saml.js", () => ({
  isSamlConfigured: mocks.isSamlConfigured,
  validateSamlResponse: mocks.validateSamlResponse,
  buildSamlAuthorizeUrl: mocks.buildSamlAuthorizeUrl,
  getSamlBaseUrl: () => "http://localhost",
  pickSamlEmail: () => "user@example.com",
  pickSamlDisplayName: () => "User",
}));

const { POST: passwordLogin } = await import("../../src/app/api/auth/login/route.js");
const { GET: oidcCallback } = await import("../../src/app/api/auth/oidc/callback/route.js");
const { POST: samlAcs } = await import("../../src/app/api/auth/saml/acs/route.js");
const { GET: oidcStart } = await import("../../src/app/api/auth/oidc/start/route.js");
const { GET: samlStart } = await import("../../src/app/api/auth/saml/start/route.js");

let cookieStore;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INITIAL_PASSWORD", "");
  cookieStore = {
    get: vi.fn((key) => ({ value: { oidc_state: "state", oidc_nonce: "nonce", oidc_code_verifier: "verifier", saml_state: "request-id" }[key] })),
    set: vi.fn(), delete: vi.fn(),
  };
  mocks.cookies.mockResolvedValue(cookieStore);
  mocks.getSettings.mockResolvedValue({ password: "hash", authMode: "password" });
  mocks.compare.mockResolvedValue(true);
  mocks.isLocalRequest.mockReturnValue(true);
  mocks.checkLock.mockReturnValue({ locked: false });
  mocks.getClientIp.mockReturnValue("203.0.113.4");
  mocks.recordFail.mockReturnValue({ remainingBeforeLock: 4 });
  mocks.isOidcConfigured.mockReturnValue(true);
  mocks.isSamlConfigured.mockReturnValue(true);
  mocks.getOidcRuntimeConfig.mockResolvedValue({ issuerUrl: "https://idp.example.com", clientId: "client" });
  mocks.fetchOidcDiscovery.mockResolvedValue({ issuer: "https://idp.example.com" });
  mocks.exchangeOidcCode.mockResolvedValue({ id_token: "secret-id-token" });
  mocks.verifyOidcIdToken.mockResolvedValue({ sub: "user" });
  mocks.validateSamlResponse.mockResolvedValue({});
  mocks.buildSamlAuthorizeUrl.mockResolvedValue({ authorizeUrl: "https://idp.example.com/saml", requestId: "request-id" });
});

afterEach(() => vi.unstubAllEnvs());

function passwordRequest(password = "correct") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", host: "localhost" },
    body: JSON.stringify({ password }),
  });
}

function oidcRequest(query = "code=secret-code&state=state") {
  return new Request(`http://localhost/api/auth/oidc/callback?${query}`);
}

function samlRequest(response = "secret-assertion") {
  return new Request("http://localhost/api/auth/saml/acs", {
    method: "POST", body: new URLSearchParams(response ? { SAMLResponse: response } : {}),
  });
}

function expectAttempt(request, method, success, reason) {
  expect(mocks.recordDashboardLogin).toHaveBeenCalledTimes(1);
  expect(mocks.recordDashboardLogin).toHaveBeenCalledWith(request, { method, success, reason });
}

describe("password login audit outcomes", () => {
  it("records success only after the session is issued", async () => {
    const request = passwordRequest();
    expect((await passwordLogin(request)).status).toBe(200);
    expectAttempt(request, "password", true);
    expect(mocks.setDashboardAuthCookie.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordDashboardLogin.mock.invocationCallOrder[0]);
  });

  it("records wrong passwords without creating a session", async () => {
    mocks.compare.mockResolvedValue(false);
    const request = passwordRequest("wrong");
    expect((await passwordLogin(request)).status).toBe(401);
    expectAttempt(request, "password", false, "invalid_password");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("records the incorrect password that triggers lockout exactly once", async () => {
    mocks.compare.mockResolvedValue(false);
    mocks.checkLock.mockReturnValueOnce({ locked: false }).mockReturnValueOnce({ locked: true, retryAfter: 30 });
    const request = passwordRequest("wrong");
    expect((await passwordLogin(request)).status).toBe(429);
    expectAttempt(request, "password", false, "invalid_password");
  });

  it("records attempts blocked by an existing lockout", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 30 });
    const request = passwordRequest();
    expect((await passwordLogin(request)).status).toBe(429);
    expectAttempt(request, "password", false, "rate_limited");
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("does not record a valid default password as success when remote access is refused", async () => {
    mocks.getSettings.mockResolvedValue({});
    mocks.isLocalRequest.mockReturnValue(false);
    const request = passwordRequest("123456");
    expect((await passwordLogin(request)).status).toBe(403);
    expectAttempt(request, "password", false, "default_password");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it.each(["oidc", "saml"])("records password login refused by %s-only authentication", async (ssoType) => {
    mocks.getSettings.mockResolvedValue({ authMode: "sso", ssoType });
    const request = passwordRequest();
    expect((await passwordLogin(request)).status).toBe(403);
    expectAttempt(request, "password", false, "password_login_disabled");
  });

  it("records disabled tunnel dashboard access", async () => {
    mocks.getSettings.mockResolvedValue({ tunnelUrl: "http://localhost", tunnelDashboardAccess: false });
    const request = passwordRequest();
    expect((await passwordLogin(request)).status).toBe(403);
    expectAttempt(request, "password", false, "dashboard_access_disabled");
  });

  it("records malformed password values as invalid requests", async () => {
    const request = passwordRequest(null);
    expect((await passwordLogin(request)).status).toBe(400);
    expectAttempt(request, "password", false, "invalid_request");
  });

  it("records session creation errors as failures", async () => {
    mocks.setDashboardAuthCookie.mockRejectedValue(new Error("session failed"));
    const request = passwordRequest();
    expect((await passwordLogin(request)).status).toBe(500);
    expectAttempt(request, "password", false, "server_error");
  });
});

describe("OIDC login audit outcomes", () => {
  it("records a verified callback once after issuing the session", async () => {
    const request = oidcRequest();
    expect((await oidcCallback(request)).headers.get("location")).toBe("http://localhost/dashboard");
    expectAttempt(request, "oidc", true);
    expect(mocks.setDashboardAuthCookie.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordDashboardLogin.mock.invocationCallOrder[0]);
  });

  it.each([
    ["error=access_denied&error_description=secret", "provider_error"],
    ["state=state", "missing_code"],
    ["code=secret-code&state=forged-state", "invalid_state"],
  ])("records rejected callback %s", async (query, reason) => {
    const request = oidcRequest(query);
    await oidcCallback(request);
    expectAttempt(request, "oidc", false, reason);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("records callback with expired state cookies", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const request = oidcRequest();
    await oidcCallback(request);
    expectAttempt(request, "oidc", false, "invalid_state");
  });

  it("records unconfigured OIDC callback", async () => {
    mocks.getOidcRuntimeConfig.mockResolvedValue(null);
    const request = oidcRequest();
    await oidcCallback(request);
    expectAttempt(request, "oidc", false, "not_configured");
  });

  it("does not store raw errors containing tokens", async () => {
    mocks.verifyOidcIdToken.mockRejectedValue(new Error("invalid token secret-id-token"));
    const request = oidcRequest();
    await oidcCallback(request);
    expectAttempt(request, "oidc", false, "oidc_callback_failed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("SAML login audit outcomes", () => {
  it("records a verified response once after issuing the session", async () => {
    const request = samlRequest();
    expect((await samlAcs(request)).headers.get("location")).toBe("http://localhost/dashboard");
    expectAttempt(request, "saml", true);
    expect(mocks.setDashboardAuthCookie.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordDashboardLogin.mock.invocationCallOrder[0]);
  });

  it("records missing assertions", async () => {
    const request = samlRequest("");
    await samlAcs(request);
    expectAttempt(request, "saml", false, "missing_response");
  });

  it("records SAML attempts refused during lockout", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 30 });
    const request = samlRequest();
    await samlAcs(request);
    expectAttempt(request, "saml", false, "rate_limited");
  });

  it("records unconfigured SAML callback", async () => {
    mocks.isSamlConfigured.mockReturnValue(false);
    const request = samlRequest();
    await samlAcs(request);
    expectAttempt(request, "saml", false, "not_configured");
  });

  it("records verification failures without storing assertions or raw errors", async () => {
    mocks.validateSamlResponse.mockRejectedValue(new Error("invalid secret-assertion"));
    const request = samlRequest();
    await samlAcs(request);
    expectAttempt(request, "saml", false, "saml_acs_failed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("SSO login start audit outcomes", () => {
  it("does not treat an outgoing redirect as a successful login", async () => {
    await oidcStart(new Request("http://localhost/api/auth/oidc/start"));
    await samlStart(new Request("http://localhost/api/auth/saml/start"));
    expect(mocks.recordDashboardLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["oidc", oidcStart, "getOidcRuntimeConfig", null, "not_configured"],
    ["saml", samlStart, "isSamlConfigured", false, "not_configured"],
  ])("records unconfigured %s start", async (method, handler, dependency, value, reason) => {
    mocks[dependency].mockReturnValue(value);
    const request = new Request(`http://localhost/api/auth/${method}/start`);
    await handler(request);
    expect(mocks.recordDashboardLogin).toHaveBeenCalledOnce();
    expect(mocks.recordDashboardLogin).toHaveBeenCalledWith(request, { method, reason });
  });

  it.each([
    ["oidc", oidcStart, "fetchOidcDiscovery", "oidc_start_failed"],
    ["saml", samlStart, "buildSamlAuthorizeUrl", "saml_start_failed"],
  ])("records %s initialization errors", async (method, handler, dependency, reason) => {
    mocks[dependency].mockRejectedValue(new Error("provider failed"));
    const request = new Request(`http://localhost/api/auth/${method}/start`);
    await handler(request);
    expect(mocks.recordDashboardLogin).toHaveBeenCalledOnce();
    expect(mocks.recordDashboardLogin).toHaveBeenCalledWith(request, { method, reason });
  });
});
