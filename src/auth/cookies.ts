/**
 * Auth cookie handling.
 *
 * The tokens live in httpOnly cookies, never in the response body (decision
 * #12). If the token came back in JSON, the dashboard would have to store it
 * somewhere, and the only place available to JavaScript is `localStorage` —
 * which any script on the page can read. An httpOnly cookie cannot be read by
 * JavaScript at all, which is the entire point.
 *
 * This also closes the live hole: the dashboard's current
 * `useCookie<boolean>('washthru-auth')` is a plain client-writable boolean, so
 * any visitor can set it in devtools and reach every page.
 */

import type { CookieOptions, Response } from 'express'
import type { Config } from '../config.js'
import { ACCESS_COOKIE, REFRESH_COOKIE } from './tokens.js'

/**
 * Where the refresh cookie is sent.
 *
 * `/api/auth` rather than `/api/auth/refresh`, so that BOTH `/refresh` and
 * `/logout` receive it. Scoped to the exact refresh path, the browser never
 * sends it to logout — which silently made logout unable to revoke the token
 * server-side, leaving a copied one valid for its full 30 days. Caught by
 * "logout revokes the refresh token server-side, not just the cookie".
 *
 * Still narrow enough to keep the long-lived credential off every ordinary API
 * call, which is the point of scoping it at all.
 */
const REFRESH_PATH = '/api/auth'

/**
 * Base cookie settings.
 *
 * `secure` is the ONLY thing that differs between development and production,
 * and it is an environment check rather than a code change. Locally, `secure:
 * true` would stop the cookie being sent over plain http and make login appear
 * broken.
 *
 * `sameSite: 'lax'` works across localhost ports and across subdomains of one
 * site, because cookies key on the registrable domain rather than the port. So
 * `localhost:3001 → localhost:3002` works in development, and
 * `dashboard.washthru.com → api.washthru.com` works in production.
 */
function baseOptions(config: Config): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
  }
}

export function setAuthCookies(
  res: Response,
  config: Config,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(config),
    maxAge: config.accessTokenTtlSeconds * 1000,
    path: '/',
  })

  // Scoped to the refresh endpoint, so the long-lived credential is not attached
  // to every ordinary API call — it is only sent where it is actually needed.
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(config),
    maxAge: config.refreshTokenTtlSeconds * 1000,
    path: REFRESH_PATH,
  })
}

/**
 * Clears both cookies.
 *
 * The options must match those used to set them — a browser will not clear a
 * cookie whose path differs, and the result is a "logout" that leaves the
 * session working.
 */
export function clearAuthCookies(res: Response, config: Config): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(config), path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(config), path: REFRESH_PATH })
}
