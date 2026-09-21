/**
 * Gives every request an id and a logger bound to it.
 *
 * Decision #15, rule 5: without this, a single failing request produces lines
 * scattered through the log with nothing tying them together. With it, one id
 * filters the whole trace.
 *
 * The id is also returned in the `X-Request-Id` header, so a user reporting a
 * problem can quote it and it can be found directly.
 */

import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Logger } from '../logger.js'

/** Header clients may send to supply their own id, and that we always echo back. */
const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Accepts a caller-supplied request id only if it looks sane, so a hostile
 * client cannot inject newlines or a megabyte of text into the logs.
 */
function safeIncomingId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 200) return null
  // Conservative: ids we accept are printable ASCII without whitespace.
  if (!/^[\w.:-]+$/.test(trimmed)) return null
  return trimmed
}

export function requestId(baseLogger: Logger): RequestHandler {
  return (req, res, next) => {
    // Reuse the caller's id when one is supplied, so a trace can be followed
    // across the dashboard and the API. Otherwise mint one.
    const id = safeIncomingId(req.get(REQUEST_ID_HEADER)) ?? randomUUID()

    req.requestId = id
    req.log = baseLogger.child({ requestId: id })

    res.setHeader('X-Request-Id', id)

    next()
  }
}
