import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DomainError, fromPostgresError } from "@/domain/shared/errors";
import type { Actor, ActorMembership } from "@/domain/identity/actor";
import type { Persona } from "@/domain/identity/persona";
import type { OnboardingState } from "@/domain/identity/lifecycle";

export interface RequestContext {
  supabase: SupabaseClient;
  actor: Actor;
  correlationId: string;
}

interface MembershipJoin {
  organization_id: string;
  persona: Persona;
  organizations: { name: string; slug: string } | { name: string; slug: string }[] | null;
}

/**
 * Assembles the authenticated actor from the database. Memberships and persona
 * grants are read through RLS, so an actor can only ever be built from rows the
 * session is actually allowed to see.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, grantsResult, membershipsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, primary_persona, onboarding_state")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("persona_grants").select("persona").eq("status", "active").eq("profile_id", user.id),
    supabase
      .from("memberships")
      .select("organization_id, persona, organizations(name, slug)")
      .eq("profile_id", user.id)
      .eq("status", "active"),
  ]);

  if (profileResult.error) throw fromPostgresError(profileResult.error);
  if (!profileResult.data) {
    // The signup trigger owns profile creation; a missing profile is a defect,
    // not something the UI should paper over.
    throw DomainError.notFound("Your profile has not finished provisioning yet.");
  }
  if (grantsResult.error) throw fromPostgresError(grantsResult.error);
  if (membershipsResult.error) throw fromPostgresError(membershipsResult.error);

  const memberships: ActorMembership[] = (membershipsResult.data ?? []).map((row) => {
    const m = row as unknown as MembershipJoin;
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    return {
      organizationId: m.organization_id,
      persona: m.persona,
      organizationName: org?.name ?? "Organization",
      organizationSlug: org?.slug ?? "",
    };
  });

  return {
    profileId: profileResult.data.id as string,
    email: user.email ?? null,
    displayName: profileResult.data.display_name as string,
    primaryPersona: profileResult.data.primary_persona as Persona,
    onboardingState: profileResult.data.onboarding_state as OnboardingState,
    platformPersonas: (grantsResult.data ?? []).map((g) => g.persona as Persona),
    memberships,
  };
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw DomainError.unauthenticated();
  return actor;
}

/** Everything a server action needs: client, actor, and a correlation id. */
export async function requireContext(): Promise<RequestContext> {
  const [supabase, actor] = await Promise.all([createSupabaseServerClient(), requireActor()]);
  return { supabase, actor, correlationId: crypto.randomUUID() };
}
