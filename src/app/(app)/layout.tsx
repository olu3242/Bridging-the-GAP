import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { BRAND_ROUTES } from "@/components/brand/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countUnread } from "@/server/services/notification-service";
import { getActor } from "@/server/services/actor";

// Every authenticated surface is per-request: it reads the session cookie and
// queries through RLS, so it must never be prerendered.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  // The proxy already turns an anonymous visit into a sign-in redirect carrying
  // `?next=`. Reaching here without an actor means the session died between the
  // two, which the auth surface names rather than silently restarting.
  if (!actor) redirect(`${BRAND_ROUTES.signIn}?error=session_expired`);

  const supabase = await createSupabaseServerClient();
  const unreadCount = await countUnread(supabase, actor.profileId).catch(() => 0);

  return (
    <AppShell actor={actor} unreadCount={unreadCount}>
      {children}
    </AppShell>
  );
}
