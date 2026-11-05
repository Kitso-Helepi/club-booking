/**
 * Expected business errors. Route handlers turn these into JSON responses;
 * anything else is an unexpected 500.
 */
export type ErrorCode =
  | "validation"
  | "not_found"
  | "unauthenticated"
  | "forbidden"
  | "unavailable" // inventory taken or sold out
  | "capacity_exceeded"
  | "hold_expired"
  | "conflict"
  | "invalid_signature"
  | "not_allowed_in_mode";

const statusFor: Record<ErrorCode, number> = {
  validation: 400,
  not_found: 404,
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 409,
  capacity_exceeded: 409,
  hold_expired: 410,
  conflict: 409,
  invalid_signature: 401,
  not_allowed_in_mode: 403,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return statusFor[this.code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
