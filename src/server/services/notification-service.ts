import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import type { NotificationRow } from "@/lib/db/types";

export interface EnqueueNotificationInput {
  profileId: string;
  category: string;
  title: string;
  /** Idempotency key: the same domain event notifies exactly once. */
  dedupeKey: string;
  body?: string;
  actionUrl?: string;
  organizationId?: string | null;
  payload?: Record<string, unknown>;
}

export async function enqueueNotification(
  supabase: SupabaseClient,
  input: EnqueueNotificationInput,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("enqueue_notification", {
    p_profile_id: input.profileId,
    p_category: input.category,
    p_title: input.title,
    p_dedupe_key: input.dedupeKey,
    p_body: input.body ?? null,
    p_action_url: input.actionUrl ?? null,
    p_organization_id: input.organizationId ?? null,
    p_channel: "in_app",
    p_payload: input.payload ?? {},
  });
  if (error) throw fromPostgresError(error, "We could not send that notification.");
  return (data as string | null) ?? null;
}

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

export async function markNotificationRead(
  supabase: SupabaseClient,
  profileId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("profile_id", profileId);
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
