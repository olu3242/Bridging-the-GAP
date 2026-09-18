import { DomainError, isDomainError } from "@/domain/shared/errors";
import type { z } from "zod";

export interface ActionState<T = undefined> {
  status: "idle" | "success" | "error";
  message?: string;
  /** Field-level messages keyed by form field name. */
  fieldErrors?: Record<string, string>;
  code?: string;
  data?: T;
}

/** Assignable to any ActionState<T>, so forms can share one initial value. */
export const idleState: ActionState<never> = { status: "idle" };

export function successState<T>(message: string, data?: T): ActionState<T> {
  return { status: "success", message, data };
}

export function errorState(
  message: string,
  fieldErrors?: Record<string, string>,
  code?: string,
): ActionState<never> {
  return { status: "error", message, fieldErrors, code };
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * Single translation point from thrown domain errors to user-facing state.
 * Unknown failures are logged with their correlation id and reported as a
 * generic message rather than leaking internals to the client.
 */
export function toActionState(error: unknown, correlationId?: string): ActionState<never> {
  if (isDomainError(error)) {
    return errorState(error.message, undefined, error.code);
  }
  console.error("[action] unhandled failure", { correlationId, error });
  return errorState("Something went wrong on our side. Please try again.", undefined, "DEPENDENCY_FAILURE");
}

export function assertNever(value: never): never {
  throw DomainError.validation(`Unsupported value: ${String(value)}`);
}
