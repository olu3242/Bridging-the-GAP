import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionDestination } from "@/server/services/session-destination";
import { resolveSiteOrigin, safeRedirectPath } from "@/lib/url";
import { exchangeErrorCode, oauthErrorCode } from "@/domain/identity/auth-errors";
import { BRAND_ROUTES } from "@/components/brand/brand";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * The one callback both auth methods come back through: email confirmation,
 * password recovery and Google OAuth.
 *
 * It exchanges the PKCE authorization code for a session cookie and then
 * resolves the destination from the *persisted* profile, which is what makes a
 * first-time Google user land on onboarding and a returning one land in the
 * product — without a second routing model for OAuth.
 *
 * The origin is resolved from forwarded headers rather than `nextUrl.origin`,
 * because behind Vercel's proxy the latter can be an internal address.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = resolveSiteOrigin(request.headers);
  const fallback = safeRedirectPath(searchParams.get("next"), BRAND_ROUTES.onboarding);

  const fail = (code: string) =>
    NextResponse.redirect(`${origin}${BRAND_ROUTES.signIn}?error=${encodeURIComponent(code)}`);

  // What the callback itself can answer comes first. A cancelled consent screen
  // and a link that carries no code are both fully decided by the query string,
  // so they must report what actually happened rather than being masked by a
  // configuration check they never reached.
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  if (providerError) {
    return fail(oauthErrorCode(providerError, searchParams.get("error_description")));
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  // Only the exchange needs a project, so this is where a missing one surfaces.
  if (!isSupabaseConfigured()) return fail("config_missing");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session?.user) {
    return fail(exchangeErrorCode(error?.message));
  }

  // A recovery link asks for /reset-password: honour it verbatim rather than
  // resolving a journey gate the visitor cannot clear without a password.
  if (fallback === BRAND_ROUTES.resetPassword) {
    return NextResponse.redirect(`${origin}${BRAND_ROUTES.resetPassword}`);
  }

  const destination = await resolveSessionDestination(supabase, data.session.user.id, fallback);
  return NextResponse.redirect(`${origin}${destination}`);
}
