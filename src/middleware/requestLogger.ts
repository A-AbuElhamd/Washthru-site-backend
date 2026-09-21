/**
 * Logs one line per completed request: method, path, status, duration.
 *
 * Deliberately NOT logged (decision #15, rules 3 and 4):
 *
 *  - **Request bodies.** `ops.contact_submissions` carries customer names,
 *    phones and emails. A generic body logger would copy every lead into Azure's
 *    logging system — a second store with different retention and different
 *    access rules. That is the same PDPL concern as lead residency, through a
 *    side door.
 *  - **Headers.** They carry the auth cookie and `Authorization`.
 *
 * Query strings ARE logged, because this API never puts personal data in a URL
 * — they hold pagination and filters only. If that ever changes, this is the
 * line to revisit.
 */

import type { RequestHandler } from 'express'

/** Statuses at or above these thresholds are logged more loudly. */
const SERVER_ERROR = 500
const CLIENT_ERROR = 400

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint()

    // `finish` fires once the response has been handed to the OS, so the
    // duration covers the real work rather than just reaching the handler.
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

      const entry = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      }

      if (res.statusCode >= SERVER_ERROR) {
        req.log.error('request failed', entry)
      } else if (res.statusCode >= CLIENT_ERROR) {
        req.log.warn('request rejected', entry)
      } else {
        req.log.http('request completed', entry)
      }
    })

    next()
  }
}
