export const DASHBOARD_LOGIN_HISTORY_LIMIT = 20;
export const DASHBOARD_LOGIN_HISTORY_MAX_RECORDS = 1000;

export const DASHBOARD_LOGIN_METHOD_LABELS = {
  password: "Password",
  oidc: "OIDC",
  saml: "SAML",
};

export const DASHBOARD_LOGIN_REASON_LABELS = {
  invalid_password: "Incorrect password",
  rate_limited: "Too many failed attempts",
  dashboard_access_disabled: "Dashboard access via tunnel is disabled",
  password_login_disabled: "Password login is disabled",
  default_password: "Default password must be changed before remote access",
  invalid_request: "Invalid login request",
  server_error: "Login could not be completed",
  provider_error: "SSO provider returned an error",
  missing_code: "Missing OIDC authorization code",
  invalid_state: "Invalid or expired SSO state",
  not_configured: "SSO is not configured",
  oidc_start_failed: "OIDC sign-in could not be started",
  oidc_callback_failed: "OIDC sign-in verification failed",
  missing_response: "Missing SAML response",
  saml_start_failed: "SAML sign-in could not be started",
  saml_acs_failed: "SAML sign-in verification failed",
};
