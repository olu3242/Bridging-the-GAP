import { describe, expect, it } from "vitest";
import { assertCan, can, governedOrganizationIds, personasOf } from "@/domain/identity/actor";
import type { Actor } from "@/domain/identity/actor";
import type { Persona } from "@/domain/identity/persona";
import { DomainError } from "@/domain/shared/errors";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "learner@example.com",
    displayName: "Ada",
    primaryPersona: "learner",
    onboardingState: "completed",
    platformPersonas: ["learner"] as Persona[],
    memberships: [],
    ...overrides,
  };
}

describe("capability checks", () => {
  it("gives a learner its own self-service surface", () => {
    const a = actor();
    expect(can(a, "profile.update_own")).toBe(true);
    expect(can(a, "learner.dashboard.view")).toBe(true);
  });

  it("does not give a learner an operator or reviewer surface", () => {
    const a = actor();
    expect(can(a, "operator.console.view")).toBe(false);
    expect(can(a, "reviewer.queue.view")).toBe(false);
    expect(can(a, "platform.govern")).toBe(false);
    expect(can(a, "audit.read_all")).toBe(false);
    expect(can(a, "funding.manage")).toBe(false);
    expect(can(a, "contribution.manage")).toBe(false);
    expect(can(a, "challenge.manage")).toBe(false);
    expect(can(a, "intelligence.read_org")).toBe(false);
  });

  it("scopes an organization persona to its own organization", () => {
    const a = actor({
      memberships: [
        {
          organizationId: ORG_A,
          organizationName: "Uni A",
          organizationSlug: "uni-a",
          persona: "institution",
        },
      ],
    });
    expect(can(a, "membership.manage", { organizationId: ORG_A })).toBe(true);
    // The same persona must not leak into another tenant.
    expect(can(a, "membership.manage", { organizationId: ORG_B })).toBe(false);
    expect(can(a, "contribution.manage", { organizationId: ORG_A })).toBe(true);
    expect(can(a, "contribution.manage", { organizationId: ORG_B })).toBe(false);
  });

  it("separates sponsor funding authority from employer work authority", () => {
    const sponsor = actor({ memberships: [{ organizationId: ORG_A, organizationName: "Fund A", organizationSlug: "fund-a", persona: "sponsor" }] });
    const employer = actor({ memberships: [{ organizationId: ORG_B, organizationName: "Work B", organizationSlug: "work-b", persona: "employer" }] });
    expect(can(sponsor, "funding.manage", { organizationId: ORG_A })).toBe(true);
    expect(can(sponsor, "contribution.manage", { organizationId: ORG_A })).toBe(false);
    expect(can(employer, "contribution.manage", { organizationId: ORG_B })).toBe(true);
    expect(can(employer, "challenge.manage", { organizationId: ORG_B })).toBe(true);
    expect(can(employer, "funding.manage", { organizationId: ORG_B })).toBe(false);
  });

  it("keeps self-service capabilities valid inside an organization context", () => {
    const a = actor({
      memberships: [
        { organizationId: ORG_A, organizationName: "Uni A", organizationSlug: "uni-a", persona: "mentor" },
      ],
    });
    expect(can(a, "profile.read_own", { organizationId: ORG_A })).toBe(true);
  });

  it("gives an operator every capability, in and out of an organization", () => {
    const a = actor({ platformPersonas: ["learner", "operator"] });
    expect(can(a, "platform.govern")).toBe(true);
    expect(can(a, "membership.manage", { organizationId: ORG_B })).toBe(true);
  });

  it("throws FORBIDDEN with the capability in the details", () => {
    try {
      assertCan(actor(), "operator.console.view");
      throw new Error("expected assertCan to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("FORBIDDEN");
      expect((error as DomainError).details).toMatchObject({ capability: "operator.console.view" });
    }
  });
});

describe("actor derivations", () => {
  it("merges platform and organization personas without duplicates", () => {
    const a = actor({
      platformPersonas: ["learner", "mentor"],
      memberships: [
        { organizationId: ORG_A, organizationName: "Uni A", organizationSlug: "uni-a", persona: "mentor" },
        { organizationId: ORG_B, organizationName: "Co B", organizationSlug: "co-b", persona: "employer" },
      ],
    });
    expect(personasOf(a).sort()).toEqual(["employer", "learner", "mentor"]);
  });

  it("reports only the organizations the actor actually governs", () => {
    const a = actor({
      memberships: [
        { organizationId: ORG_A, organizationName: "Uni A", organizationSlug: "uni-a", persona: "mentor" },
        { organizationId: ORG_B, organizationName: "Co B", organizationSlug: "co-b", persona: "employer" },
      ],
    });
    expect(governedOrganizationIds(a)).toEqual([ORG_B]);
  });
});
