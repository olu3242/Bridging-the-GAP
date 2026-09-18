import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/**
 * Refreshes the Supabase session cookie on every request and keeps
 * unauthenticated visitors out of the authenticated surface. Route handlers and
 * RLS re-check authorization; this is convenience, not a security boundary.
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
