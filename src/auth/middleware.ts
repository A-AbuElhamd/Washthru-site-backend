/**
 * Authentication middleware.
 *
 * Reads the access token from its httpOnly cookie, verifies it, and attaches the
 * caller to the request. Anything without a valid token gets 401.
 *
 * ⚠️ THE RISK THIS FILE CARRIES
 * -----------------------------
 * Auth in Express is opt-in: a route is protected only because someone
 * remembered to attach this. A new endpoint added without it is wide open, and
 * nothing fails — it just works, for everyone.
 *
 * That is why `tests/auth.db.test.ts` enumerates every registered route and
 * asserts each returns 401 without a token. It is the cheapest test in the suite
 * and it guards the most expensive mistake.
 */

import type { RequestHandler } from 'express'
import { unauthorized } from '../errors.js'
import type { Deps } from '../deps.js'
import { ACCESS_COOKIE, verifyAccessToken, type AccessTokenClaims } from './tokens.js'

/** The authenticated caller, attached to the request. */
export interface AuthenticatedUser {
  id: string
  email: string
  role: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Absent on unauthenticated routes. */
      user?: AuthenticatedUser
    }
  }
}

function claimsToUser(claims: AccessTokenClaims): AuthenticatedUser {
  return { id: claims.sub, email: claims.email, role: claims.role }
}

/**
 * Rejects any request without a valid access token.
 *
 * Deliberately does NOT hit the database. Checking a signature is fast and
 * local; looking up the user on every request would add a query to every
 * endpoint for little gain, since the token is short-lived anyway. The cost is
 * that a deleted user keeps working until their access token expires — bounded
 * by `ACCESS_TOKEN_TTL_SECONDS`, and their refresh token is already gone, so
 * they cannot renew.
 */
export function requireAuth(deps: Deps): RequestHandler {
  return async (req, _res, next) => {
    const token = (req.cookies as Record<string, unknown> | undefined)?.[ACCESS_COOKIE]

    if (typeof token !== 'string' || token.length === 0) {
      next(unauthorized())
      return
    }

    const claims = await verifyAccessToken(token, {
      secret: deps.config.jwtSecret,
      now: deps.clock(),
    })

    if (!claims) {
      // One message for expired, tampered-with and malformed alike — telling a
      // caller which it was helps them probe the implementation.
      next(unauthorized())
      return
    }

    req.user = claimsToUser(claims)
    next()
  }
}
