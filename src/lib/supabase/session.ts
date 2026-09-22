import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { PRODUCT_HOME, isPathAllowed, resolveDestination } from "@/domain/identity/journey";
import { isAuthRoute, isJourneyGated, requiresSession } from "@/domain/identity/routes";
import { BRAND_ROUTES } from "@/components/brand/brand";
import type { OnboardingState } from "@/domain/identity/lifecycle";
import type { Persona } from "@/domain/identity/persona";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response;

  const env = publicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          // The PKCE verifier is server-only; see `harden` in ./server.ts.
          const hardened = name.includes("code-verifier") ? { ...options, httpOnly: true } : options;
          response.cookies.set(name, value, hardened);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const needsSession = requiresSession(pathname);

  if (!user) {
    if (needsSession) {
      const url = request.nextUrl.clone();
      url.pathname = BRAND_ROUTES.signIn;
      url.search = "";
      // Carry the destination so signing in returns the visitor to it.
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Signed in. Resolve where this actor actually belongs from persisted state,
  // rather than assuming the dashboard. `/reset-password` is deliberately not
  // journey-gated: a recovery session must be able to finish.
  const onAuthRoute = isAuthRoute(pathname);
  if (!isJourneyGated(pathname) && !onAuthRoute) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_state, baseline_completed_at, active_pathway_id, primary_persona")
    .eq("id", user.id)
    .maybeSingle();

  const state = {
    authenticated: true,
    onboardingState: (profile?.onboarding_state as OnboardingState) ?? "not_started",
    baselineCompleted: Boolean(profile?.baseline_completed_at),
    pathwayGenerated: Boolean(profile?.active_pathway_id),
    primaryPersona: profile?.primary_persona as Persona | undefined,
  };

  if (onAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = resolveDestination(state);
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!isPathAllowed(state, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = resolveDestination(state);
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Onboarding is finished: the onboarding route itself is no longer a valid
  // place to sit.
  if (pathname === BRAND_ROUTES.onboarding && state.onboardingState === "completed") {
    const url = request.nextUrl.clone();
    url.pathname = PRODUCT_HOME;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
