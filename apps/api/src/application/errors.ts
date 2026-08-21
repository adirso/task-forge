export type ApplicationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "INTERNAL";

/** Stable errors for use cases. HTTP adapters can map these to status codes. */
export class ApplicationError extends Error {
  readonly issues?: readonly unknown[];
  readonly statusCode: number;
  constructor(public readonly code: ApplicationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.statusCode = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400, INTERNAL: 500 }[code];
    this.name = "ApplicationError";
  }
}

export class UnauthenticatedError extends ApplicationError {
  constructor(message = "Authentication is required") { super("UNAUTHENTICATED", message); this.name = "UnauthenticatedError"; }
}

export class ForbiddenError extends ApplicationError {
  constructor(message = "You are not allowed to perform this action") { super("FORBIDDEN", message); this.name = "ForbiddenError"; }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string, message = `${resource} was not found`) { super("NOT_FOUND", message); this.name = "NotFoundError"; }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) { super("CONFLICT", message); this.name = "ConflictError"; }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, public readonly issues?: readonly unknown[]) { super("VALIDATION", message); this.name = "ValidationError"; }
}
