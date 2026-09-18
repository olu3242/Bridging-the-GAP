import { describe, expect, it } from "vitest";
import { DomainError, fromPostgresError, isDomainError } from "@/domain/shared/errors";
import { AUDIT_ACTIONS, AUDIT_ACTION_PATTERN } from "@/domain/shared/audit";
import { createOrganizationSchema, slugify } from "@/domain/identity/organization";

describe("postgres error translation", () => {
  it("maps a unique violation to a conflict", () => {
    expect(fromPostgresError({ code: "23505", message: "duplicate key" }).code).toBe("CONFLICT");
  });

  it("maps an RLS write denial to forbidden", () => {
    expect(fromPostgresError({ code: "42501", message: "permission denied" }).code).toBe("FORBIDDEN");
  });

  it("recognises a state machine rejection raised by the trigger", () => {
    const error = fromPostgresError({
      code: "23514",
      message: "invalid membership transition: revoked -> active",
    });
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.details).toMatchObject({ machine: "membership", from: "revoked", to: "active" });
  });

  it("falls back to a dependency failure for unknown codes", () => {
    expect(fromPostgresError({ code: "XX000", message: "boom" }).code).toBe("DEPENDENCY_FAILURE");
    expect(fromPostgresError({ message: "no code" }).code).toBe("DEPENDENCY_FAILURE");
  });

  it("narrows domain errors", () => {
    expect(isDomainError(DomainError.notFound())).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
  });
});

describe("audit vocabulary", () => {
  it("keeps every canonical action in the format the database enforces", () => {
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(action).toMatch(AUDIT_ACTION_PATTERN);
    }
  });
});

describe("organization input", () => {
  it("derives a usable handle from a name", () => {
    expect(slugify("University of Lagos!")).toBe("university-of-lagos");
  });

  it("rejects a handle with invalid characters", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Acme",
      slug: "Acme Corp",
      type: "employer",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the platform organization type from the public command", () => {
    expect(
      createOrganizationSchema.safeParse({ name: "BTG", slug: "btg", type: "platform" }).success,
    ).toBe(false);
  });
});
