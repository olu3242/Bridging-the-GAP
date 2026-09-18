import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import { membershipMachine, type MembershipStatus } from "@/domain/identity/lifecycle";
import type { MembershipRow, OrganizationRow } from "@/lib/db/types";

export interface CreateOrganizationCommand {
  name: string;
  slug: string;
  type: "institution" | "employer" | "sponsor";
  website?: string | null;
  countryCode?: string | null;
}

/** Creates the organization and its founding governing membership atomically. */
export async function createOrganization(
  supabase: SupabaseClient,
  command: CreateOrganizationCommand,
  correlationId: string,
): Promise<OrganizationRow> {
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: command.name,
    p_slug: command.slug,
    p_type: command.type,
    p_website: command.website ?? null,
    p_country_code: command.countryCode ?? null,
    p_correlation_id: correlationId,
  });
  if (error) {
    const domainError = fromPostgresError(error, "We could not create that organization.");
    if (domainError.code === "CONFLICT") {
      throw Object.assign(domainError, { message: "That organization handle is already taken." });
    }
    throw domainError;
  }
  return data as OrganizationRow;
}

export async function listOrganizationsForActor(supabase: SupabaseClient): Promise<OrganizationRow[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw fromPostgresError(error, "We could not load your organizations.");
  return (data ?? []) as OrganizationRow[];
}

export async function listMemberships(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw fromPostgresError(error, "We could not load that member list.");
  return (data ?? []) as MembershipRow[];
}

/**
 * Transitions a membership. The machine is checked here for a fast, readable
 * failure; the database trigger enforces the same rule independently.
 */
export async function setMembershipStatus(
  supabase: SupabaseClient,
  membershipId: string,
  from: MembershipStatus,
  to: MembershipStatus,
): Promise<MembershipRow> {
  membershipMachine.assert(from, to);
  const { data, error } = await supabase
    .from("memberships")
    .update({ status: to })
    .eq("id", membershipId)
    .eq("status", from) // optimistic guard against a concurrent transition
    .select("*")
    .maybeSingle();
  if (error) throw fromPostgresError(error, "We could not update that membership.");
  if (!data) {
    throw fromPostgresError(
      { code: "23514", message: "That membership changed while you were working on it." },
      "That membership changed while you were working on it.",
    );
  }
  return data as MembershipRow;
}
