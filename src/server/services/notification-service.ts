import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { NotificationRow } from "@/lib/db/types";

/**
 * Notifications are enqueued from inside the governed commands via `btg.notify`,
 * which is not granted to any session role. The client-callable
 * `public.enqueue_notification` wrapper that used to live here had no callers,
 * and its grant let any session push a notification at itself; migration
 * 20260918003800 revoked it. This module reads and marks read, nothing more.
 */
export async function listNotifications(
  supabase: SupabaseClient,
  profileId: string,
  limit = 8,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw fromPostgresError(error, "We could not load your notifications.");
  return (data ?? []) as NotificationRow[];
}

/**
 * Marks the caller's own notification read. The command marks the row and
 * records the ledger entry in one transaction, so the application no longer
 * needs — and no longer has — a general audit write path.
 */
export async function markNotificationRead(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  if (error) throw fromPostgresError(error, "We could not update that notification.");
}

export async function countUnread(supabase: SupabaseClient, profileId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .in("status", ["pending", "sent"]);
  if (error) throw fromPostgresError(error);
  return count ?? 0;
}
