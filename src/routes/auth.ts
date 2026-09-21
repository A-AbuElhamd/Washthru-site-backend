/**
 * Authentication endpoints.
 *
 *   POST /api/auth/login     email + password  → sets cookies, returns the user
 *   POST /api/auth/refresh   swaps a refresh token for a new pair
 *   POST /api/auth/logout    revokes the refresh token and clears cookies
 *   GET  /api/auth/me        the current user, or 401
 *
 * `/me` exists because of the httpOnly decision: the dashboard can no longer
 * read the cookie to find out whether it is logged in, so it asks the server.
 * That replaces `useCookie<boolean>('washthru-auth')` in the dashboard's
 * `middleware/auth.global.ts`.
 */

import { Router } from 'express'
import Joi from 'joi'
import type { Deps } from '../deps.js'
import { unauthorized, validationFailed, type FieldError } from '../errors.js'
import { verifyPassword } from '../auth/password.js'
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  REFRESH_COOKIE,
} from '../auth/tokens.js'
import { clearAuthCookies, setAuthCookies } from '../auth/cookies.js'
import { requireAuth } from '../auth/middleware.js'

const loginSchema = Joi.object({
  // `tlds: { allow: false }` turns off Joi's check against its BUNDLED list of
  // top-level domains. That list goes stale — it rejects newer TLDs and any
  // internal or reserved one — so it would reject genuine addresses while
  // adding nothing: the password still has to be correct.
  email: Joi.string().email({ tlds: { allow: false } }).required().messages({
    'any.required': 'Email is required',
    'string.email': 'Enter a valid email address',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
    'string.empty': 'Password is required',
  }),
})

/**
 * ONE message for every login failure.
 *
 * Whether the email does not exist or the password is wrong, the response is
 * identical. Distinct messages would turn this endpoint into a way to discover
 * which email addresses have accounts.
 */
const LOGIN_FAILED = 'Email or password is incorrect'

export function authRoutes(deps: Deps): Router {
  const router = Router()

  router.post('/login', async (req, res) => {
    const { error, value } = loginSchema.validate(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true,
    })

    if (error) {
      const fields: FieldError[] = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }))
      throw validationFailed(fields)
    }

    const { email, password } = value as { email: string; password: string }

    const user = await deps.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    })

    // Verify against a dummy hash when the user is missing, so a wrong email and
    // a wrong password take about the same time. Otherwise the difference is
    // measurable and reveals which addresses exist.
    const storedHash = user?.passwordHash ?? DUMMY_HASH
    const ok = await verifyPassword(storedHash, password)

    if (!user || !ok) {
      // Never log the attempted password, and never log which half failed.
      req.log.warn('login failed', { email })
      throw unauthorized(LOGIN_FAILED)
    }

    await issueSession(deps, res, user)

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  })

  /**
   * Swaps a refresh token for a fresh pair.
   *
   * The old token is revoked as part of the swap — **rotation**. Without it, a
   * stolen refresh token stays valid for its full 30 days alongside the real
   * one. With it, whichever party refreshes second is rejected, so the theft
   * surfaces instead of going unnoticed.
   */
  router.post('/refresh', async (req, res) => {
    const presented = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE]

    if (typeof presented !== 'string' || presented.length === 0) {
      throw unauthorized('Session expired. Please sign in again')
    }

    const now = deps.clock()
    const stored = await deps.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presented) },
      include: { user: true },
    })

    const usable =
      stored && stored.revokedAt === null && stored.expiresAt > now && stored.user.deletedAt === null

    if (!usable || !stored) {
      throw unauthorized('Session expired. Please sign in again')
    }

    // Rotate: the presented token is spent.
    await deps.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: now },
    })

    await issueSession(deps, res, stored.user)

    res.json({
      user: {
        id: stored.user.id,
        name: stored.user.name,
        email: stored.user.email,
        role: stored.user.role,
      },
    })
  })

  /**
   * Logout.
   *
   * Revokes the refresh token server-side as well as clearing the cookies —
   * clearing cookies alone would leave a copied token working for 30 days.
   *
   * Always returns 204, even with no valid session. "Log me out" should never
   * fail; there is nothing useful a client could do with an error here.
   */
  router.post('/logout', async (req, res) => {
    const presented = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE]

    if (typeof presented === 'string' && presented.length > 0) {
      await deps.prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(presented), revokedAt: null },
        data: { revokedAt: deps.clock() },
      })
    }

    clearAuthCookies(res, deps.config)
    res.status(204).send()
  })

  /** Who am I? 200 with the user, or 401. The dashboard's login check. */
  router.get('/me', requireAuth(deps), async (req, res) => {
    // `requireAuth` guarantees this, but the type does not — `req.user` is
    // optional because most routes never set it.
    const userId = req.user?.id
    if (!userId) throw unauthorized()

    const user = await deps.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    })

    // The token was valid but the account is gone — deleted mid-session.
    if (!user) throw unauthorized()

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  })

  return router
}

/** Issues an access token and a fresh refresh token, and sets both cookies. */
async function issueSession(
  deps: Deps,
  res: Parameters<typeof setAuthCookies>[0],
  user: { id: string; email: string; role: string },
): Promise<void> {
  const now = deps.clock()

  const accessToken = await signAccessToken(
    { sub: user.id, email: user.email, role: user.role },
    {
      secret: deps.config.jwtSecret,
      ttlSeconds: deps.config.accessTokenTtlSeconds,
      now,
    },
  )

  const refresh = createRefreshToken()

  await deps.prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.hash,
      expiresAt: new Date(now.getTime() + deps.config.refreshTokenTtlSeconds * 1000),
    },
  })

  setAuthCookies(res, deps.config, { accessToken, refreshToken: refresh.token })
}

/**
 * A real argon2id hash of a throwaway value.
 *
 * Used when no user matched, purely so the verify step still costs the same
 * amount of time. Without it, a missing email returns noticeably faster than a
 * wrong password, which leaks which addresses are registered.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$8sJqKMRz3vJvEXMFYCWqOHXxTZ8Yh0mKvPxGZ0vZ1kA'
