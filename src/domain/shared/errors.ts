/**
 * Canonical domain error taxonomy. Every layer above (services, server actions,
 * UI) maps failures onto these codes instead of leaking driver errors.
 */
export const DOMAIN_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "INVALID_TRANSITION",
  "CONFLICT",
  "DEPENDENCY_FAILURE",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  static unauthenticated(message = "You need to sign in to continue.") {
    return new DomainError("UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have access to this action.", details?: Record<string, unknown>) {
    return new DomainError("FORBIDDEN", message, details);
  }

  static notFound(message = "We could not find what you were looking for.") {
    return new DomainError("NOT_FOUND", message);
  }

  static validation(message: string, details?: Record<string, unknown>) {
    return new DomainError("VALIDATION", message, details);
  }

  static invalidTransition(machine: string, from: string, to: string) {
    return new DomainError(
      "INVALID_TRANSITION",
      `A ${machine} cannot move from ${from} to ${to}.`,
      { machine, from, to },
    );
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new DomainError("CONFLICT", message, details);
  }

  static dependency(message = "A downstream service failed.", details?: Record<string, unknown>) {
    return new DomainError("DEPENDENCY_FAILURE", message, details);
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** Postgres error codes the database raises for our authorization/state rules. */
const PG_CODE_MAP: Record<string, DomainErrorCode> = {
  "23505": "CONFLICT", // unique_violation
  "23503": "VALIDATION", // foreign_key_violation
  "23514": "VALIDATION", // check_violation
  "42501": "FORBIDDEN", // insufficient_privilege (incl. RLS denial on write)
  "28000": "UNAUTHENTICATED",
  "P0001": "VALIDATION", // raise_exception
  "2F004": "FORBIDDEN",
  "0A000": "FORBIDDEN",
};

type PostgrestLike = { code?: string; message?: string; details?: string | null };

/** Translate a PostgREST/Postgres failure into the domain taxonomy. */
export function fromPostgresError(error: PostgrestLike, fallback = "The request could not be completed."): DomainError {
  const message = error.message ?? fallback;
  if (message.includes("invalid ") && message.includes(" transition: ")) {
    const match = /invalid (\w+) transition: (\w+) -> (\w+)/.exec(message);
    if (match) return DomainError.invalidTransition(match[1], match[2], match[3]);
  }
  const code: DomainErrorCode = (error.code ? PG_CODE_MAP[error.code] : undefined) ?? "DEPENDENCY_FAILURE";
  return new DomainError(code, message, { pgCode: error.code, details: error.details ?? undefined });
}
