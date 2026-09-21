/**
 * Application errors and the single response envelope every failure uses.
 *
 * Decision #18: validation failures, not-found, unauthorized and server faults
 * all come back in the same shape, so the dashboard writes error handling once
 * rather than branching per endpoint:
 *
 *   {
 *     "error": {
 *       "code": "VALIDATION_FAILED",
 *       "message": "Check the highlighted fields",
 *       "fields": [ { "field": "titleAr", "message": "Arabic title is required" } ]
 *     }
 *   }
 *
 * `fields` is present only for validation failures.
 *
 * The envelope is deliberately independent of Joi. Joi produces the field list,
 * but the wire format is ours — so replacing the validator later would not
 * change this API.
 */

/**
 * Machine-readable error codes. The dashboard branches on these, never on the
 * human-readable message, so messages can be reworded freely.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'

/** One invalid field, for forms. `field` matches the request body's key. */
export interface FieldError {
  field: string
  message: string
}

export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    fields?: FieldError[]
  }
}

/**
 * An error that carries an intended HTTP status and error code.
 *
 * Anything thrown that is NOT an `AppError` is treated as an unexpected fault:
 * logged with its stack, and reported to the client as a generic 500 with no
 * internal detail. That split is deliberate — `AppError` messages are written
 * to be read by users; other messages are not.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: ErrorCode
  readonly fields: FieldError[] | undefined

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    fields?: FieldError[],
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.fields = fields
    // Keeps the stack trace pointing at the throw site rather than this constructor.
    Error.captureStackTrace(this, this.constructor)
  }

  /** Serialises to the wire envelope above. */
  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    }
  }
}

/* -------------------------------------------------------------------------- *
 * Constructors
 *
 * Use these rather than `new AppError(...)` at call sites — they keep status
 * codes consistent across the codebase and read better in route handlers.
 * -------------------------------------------------------------------------- */

/** 400 — the request body failed validation. Carries the per-field list. */
export const validationFailed = (fields: FieldError[], message = 'Check the highlighted fields'): AppError =>
  new AppError(400, 'VALIDATION_FAILED', message, fields)

/**
 * 401 — not signed in, or credentials rejected.
 *
 * Login failures deliberately use one message for "no such email" and "wrong
 * password". Distinct messages would tell an attacker which addresses are real
 * accounts.
 */
export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message)

/** 403 — signed in, but not allowed to do this. */
export const forbidden = (message = 'You do not have permission to do that'): AppError =>
  new AppError(403, 'FORBIDDEN', message)

/** 404 — no such record. */
export const notFound = (message = 'Not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message)

/** 409 — conflicts with existing data, e.g. a duplicate slug. */
export const conflict = (message = 'That already exists'): AppError =>
  new AppError(409, 'CONFLICT', message)

/** 413 — upload exceeds the size limit. */
export const payloadTooLarge = (message = 'That file is too large'): AppError =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message)

/** 415 — the file is not a type we accept (checked by content, not extension). */
export const unsupportedMediaType = (message = 'That file type is not supported'): AppError =>
  new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message)

/** 429 — too many requests from this client. */
export const rateLimited = (message = 'Too many requests. Please try again later'): AppError =>
  new AppError(429, 'RATE_LIMITED', message)

/** Type guard used by the error handler to separate expected from unexpected. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
