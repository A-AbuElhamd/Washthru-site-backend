/**
 * The last middleware in the stack: turns anything thrown into the single
 * error envelope from decision #18.
 *
 * WHY EXPRESS 5 MATTERS HERE (decision #9)
 * ----------------------------------------
 * In Express 4, a `throw` inside an `async` handler was never passed to the
 * error handler — the promise rejected, nothing caught it, and the request hung
 * until the client timed out. Every Express 4 tutorial works around this with
 * `asyncHandler` wrappers or `.catch(next)` on every route.
 *
 * Express 5 forwards rejected promises to the error handler automatically, so
 * route handlers can simply `throw` and this middleware deals with it. Most
 * material online still shows the v4 pattern; it is not needed here.
 *
 * TWO CLASSES OF ERROR
 * --------------------
 *  - `AppError` — deliberate. Its message was written to be read by a user, so
 *    it is sent as-is with its intended status code.
 *  - Anything else — unexpected. Logged in full with its stack, and reported to
 *    the client as a bare 500. Internal messages can leak file paths, SQL, or
 *    library internals, so they never cross the wire.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express'
import { AppError, isAppError, notFound } from '../errors.js'
import { logger as baseLogger } from '../logger.js'

/**
 * Catches requests that matched no route, so a wrong URL produces the same
 * error envelope as everything else rather than Express's default HTML page.
 *
 * Mounted after all routes, before `errorHandler`.
 */
/**
 * Recognises body-parser's malformed-JSON error.
 *
 * It sets `status: 400` and `type: 'entity.parse.failed'`. Its `message`
 * contains a fragment of the raw body, and its `body` property holds the body in
 * full — neither may ever be logged. See the handler below.
 */
function isBodyParseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { type?: unknown; status?: unknown }
  return (
    candidate.type === 'entity.parse.failed' ||
    (error instanceof SyntaxError && candidate.status === 400)
  )
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('That endpoint does not exist'))
}

export function errorHandler(): ErrorRequestHandler {
  // Express identifies the error handler by its four-parameter signature, so
  // `next` must stay even though it is unused. The leading underscore tells
  // TypeScript's `noUnusedParameters` that this is intentional.
  return (error, req, res, _next) => {
    // `req.log` is set by the `requestId` middleware. It runs first, so it is
    // normally present — but if IT ever throws, this handler would crash on
    // `req.log.error` and Express would fall back to its default HTML error
    // page, leaking a stack trace. Falling back to the plain logger removes that
    // path entirely.
    const log = req.log ?? baseLogger

    // If the response has already started, headers are on the wire and nothing
    // useful can be sent. Hand back to Express, which will destroy the socket.
    if (res.headersSent) {
      log.error('error after response started', {
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (isAppError(error)) {
      // Expected failure. 4xx is normal traffic (a form filled in wrongly), so
      // log it at `warn`; a 5xx AppError is genuinely our fault.
      const level = error.statusCode >= 500 ? 'error' : 'warn'
      log.log(level, 'request error', {
        code: error.code,
        status: error.statusCode,
      })

      res.status(error.statusCode).json(error.toBody())
      return
    }

    // ⚠️ A MALFORMED BODY IS A CLIENT ERROR, AND ITS MESSAGE CONTAINS THE BODY.
    //
    // body-parser throws a SyntaxError with `status: 400`, and V8 embeds ~20
    // characters of the offending JSON in the message — which for a slightly
    // broken login request means a fragment of the PASSWORD. Both `message` and
    // `stack` bypass the logger's redaction (it deliberately leaves `message`
    // alone so real text is not mangled), so logging them would write password
    // fragments into Azure Monitor. That is precisely what decision #15 rule 4
    // exists to prevent.
    //
    // So: treat it as the 400 it is, and log NOTHING from the error itself.
    if (isBodyParseError(error)) {
      log.warn('malformed request body', { status: 400 })
      const badBody = new AppError(
        400,
        'VALIDATION_FAILED',
        'The request body is not valid JSON',
      )
      res.status(400).json(badBody.toBody())
      return
    }

    // Unexpected. Log everything we have — this is the one place a full stack
    // is genuinely wanted.
    log.error('unhandled error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Generic body: never expose internal detail. The request id is included so
    // a user can report the failure and it can be found in the logs.
    const internal = new AppError(
      500,
      'INTERNAL_ERROR',
      `Something went wrong. Reference: ${req.requestId}`,
    )
    res.status(500).json(internal.toBody())
  }
}
