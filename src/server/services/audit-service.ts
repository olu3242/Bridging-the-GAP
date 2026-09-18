import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEventInput } from "@/domain/shared/audit";
import type { Actor } from "@/domain/identity/actor";

/**
 * E16 — the only write path into the audit ledger. The database stamps the
 * actor from the session, so a forged actor is impossible.
 */
export async function recordAudit(
  supabase: SupabaseClient,
  actor: Actor,
  input: AuditEventInput & { correlationId?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc("record_audit_event", {
    p_action: input.action,
    p_object_type: input.objectType,
    p_object_id: input.objectId ?? null,
    p_organization_id: input.organizationId ?? null,
    p_actor_persona: input.actorPersona ?? actor.primaryPersona,
    p_before: input.before ?? null,
    p_after: input.after ?? null,
    p_severity: input.severity ?? "info",
    p_correlation_id: input.correlationId ?? null,
    p_workflow: input.workflow ?? null,
    p_policy_version: input.policyVersion ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    // Audit must never silently vanish, but it also must not mask the outcome
    // of an action that already committed.
    console.error("[audit] failed to record event", {
      action: input.action,
      objectType: input.objectType,
      correlationId: input.correlationId,
      error: error.message,
    });
  }
}
