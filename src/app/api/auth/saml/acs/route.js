import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import {
  getSamlBaseUrl,
  isSamlConfigured,
  pickSamlDisplayName,
  pickSamlEmail,
  validateSamlResponse,
} from "@/lib/auth/saml.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { recordDashboardLogin } from "@/lib/auth/loginHistory";

export async function POST(request) {
  const logAttempt = (success, reason) => recordDashboardLogin(request, { method: "saml", success, reason });
  const settings = await getSettings();
  const origin = getSamlBaseUrl(request, settings);
  const ip = getClientIp(request);

  const lock = checkLock(ip);
  if (lock.locked) {
    await logAttempt(false, "rate_limited");
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(`Too many failed attempts. Try again in ${lock.retryAfter}s.`)}`,
        origin
      )
    );
  }

  const cookieStore = await cookies();
  const storedRequestId = cookieStore.get("saml_state")?.value || "";

  // Always clear saml_state cookie after attempt
  cookieStore.delete("saml_state");

  try {
    const formData = await request.formData();
    const SAMLResponse = formData.get("SAMLResponse");

    if (!SAMLResponse) {
      recordFail(ip);
      await logAttempt(false, "missing_response");
      return NextResponse.redirect(new URL("/login?error=saml_missing_response", origin));
    }

    if (!isSamlConfigured(settings)) {
      recordFail(ip);
      await logAttempt(false, "not_configured");
      return NextResponse.redirect(new URL("/login?error=saml_not_configured", origin));
    }

    const profile = await validateSamlResponse(request, { SAMLResponse }, storedRequestId, settings);

    const samlEmail = pickSamlEmail(profile, settings) || null;
    const samlName = pickSamlDisplayName(profile, settings) || "SAML user";

    recordSuccess(ip);

    await setDashboardAuthCookie(cookieStore, request, {
      saml: true,
      samlEmail,
      samlName,
    });
    await logAttempt(true);

    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch (error) {
    recordFail(ip);
    await logAttempt(false, "saml_acs_failed");
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message || "saml_acs_failed")}`, origin)
    );
  }
}
