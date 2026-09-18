import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { PRODUCT_HOME, isPathAllowed, resolveDestination } from "@/domain/identity/journey";
import type { OnboardingState } from "@/domain/identity/lifecycle";

/** Routes that require an authenticated actor. */
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/organizations"];
/** Routes a signed-in learner should never sit on. */
const AUTH_PREFIXES = ["/sign-in", "/join"];

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

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
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = matches(pathname, PROTECTED_PREFIXES);
  const isAuthRoute = matches(pathname, AUTH_PREFIXES);

  if (!user) {
    if (isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Signed in. Resolve where this learner actually belongs from persisted
  // state, rather than assuming the dashboard.
  if (!isProtected && !isAuthRoute) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("id", user.id)
    .maybeSingle();

  const state = {
    authenticated: true,
    onboardingState: (profile?.onboarding_state as OnboardingState) ?? "not_started",
  };

  if (isAuthRoute) {
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
  if (pathname === "/onboarding" && state.onboardingState === "completed") {
    const url = request.nextUrl.clone();
    url.pathname = PRODUCT_HOME;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
