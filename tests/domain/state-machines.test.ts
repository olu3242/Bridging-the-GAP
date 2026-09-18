import { describe, expect, it } from "vitest";
import {
  membershipMachine,
  onboardingMachine,
  organizationMachine,
  personaGrantMachine,
} from "@/domain/identity/lifecycle";
import { DomainError } from "@/domain/shared/errors";

describe("membership lifecycle", () => {
  it("allows the documented transitions", () => {
    expect(membershipMachine.can("invited", "active")).toBe(true);
    expect(membershipMachine.can("active", "suspended")).toBe(true);
    expect(membershipMachine.can("suspended", "active")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(membershipMachine.can("revoked", "active")).toBe(false);
    expect(membershipMachine.can("invited", "suspended")).toBe(false);
  });

  it("treats revoked as terminal", () => {
    expect(membershipMachine.next("revoked")).toHaveLength(0);
  });

  it("throws a typed domain error on an invalid transition", () => {
    try {
      membershipMachine.assert("revoked", "active");
      throw new Error("expected assert to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("INVALID_TRANSITION");
      expect((error as DomainError).details).toMatchObject({ from: "revoked", to: "active" });
    }
  });

  it("treats a no-op transition as allowed", () => {
    expect(membershipMachine.can("active", "active")).toBe(true);
  });
});

describe("onboarding is linear and forward-only", () => {
  it("cannot skip consent", () => {
    expect(onboardingMachine.can("goals", "completed")).toBe(false);
    expect(onboardingMachine.can("not_started", "completed")).toBe(false);
  });

  it("cannot rewind", () => {
    expect(onboardingMachine.can("consent", "goals")).toBe(false);
    expect(onboardingMachine.can("completed", "profile")).toBe(false);
  });

  it("walks the whole path one step at a time", () => {
    const path = ["not_started", "profile", "persona", "goals", "consent", "completed"] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(onboardingMachine.can(path[i], path[i + 1])).toBe(true);
    }
  });
});

describe("other lifecycles", () => {
  it("archives organizations terminally", () => {
    expect(organizationMachine.can("archived", "active")).toBe(false);
    expect(organizationMachine.can("pending", "suspended")).toBe(false);
  });

  it("does not resurrect revoked persona grants", () => {
    expect(personaGrantMachine.can("revoked", "active")).toBe(false);
  });
});
