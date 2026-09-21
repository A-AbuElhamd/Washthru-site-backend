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

/**
 * Catches requests that matched no route, so a wrong URL produces the same
 * error envelope as everything else rather than Express's default HTML page.
 *
 * Mounted after all routes, before `errorHandler`.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('That endpoint does not exist'))
}

export function errorHandler(): ErrorRequestHandler {
  // Express identifies the error handler by its four-parameter signature, so
  // `next` must stay even though it is unused. The leading underscore tells
  // TypeScript's `noUnusedParameters` that this is intentional.
  return (error, req, res, _next) => {
    // If the response has already started, headers are on the wire and nothing
    // useful can be sent. Hand back to Express, which will destroy the socket.
    if (res.headersSent) {
      req.log.error('error after response started', {
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (isAppError(error)) {
      // Expected failure. 4xx is normal traffic (a form filled in wrongly), so
      // log it at `warn`; a 5xx AppError is genuinely our fault.
      const level = error.statusCode >= 500 ? 'error' : 'warn'
      req.log.log(level, 'request error', {
        code: error.code,
        status: error.statusCode,
      })

      res.status(error.statusCode).json(error.toBody())
      return
    }

    // Unexpected. Log everything we have — this is the one place a full stack
    // is genuinely wanted.
    req.log.error('unhandled error', {
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
