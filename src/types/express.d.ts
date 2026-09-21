/**
 * Extra properties this application attaches to Express's `Request`.
 *
 * Express has no built-in way to carry per-request state, so middleware hangs
 * values off the request object. Declaring them here means TypeScript knows
 * about them everywhere instead of each handler casting to `any`.
 */

import type { Logger } from '../logger.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Unique id for this request, set by `requestId` middleware and echoed in
       * the `X-Request-Id` response header. Given to the client so a user
       * reporting a problem can quote it and it can be found in the logs.
       */
      requestId: string

      /**
       * Logger bound to this request's id. Every line it writes carries
       * `requestId`, so one failure reads as one filterable trace rather than
       * scattered lines (decision #15, rule 5).
       */
      log: Logger
    }
  }
}

// Required so TypeScript treats this file as a module, which `declare global` needs.
export {}
