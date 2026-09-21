/**
 * Token issuing and verification.
 *
 * THE TWO-TOKEN DESIGN (decision #12)
 * -----------------------------------
 * A JWT is valid until it expires and the server cannot take it back. That is
 * the known gap in JWT auth: logging out, or removing someone who has left, does
 * not actually stop a token that is already issued.
 *
 * So there are two halves:
 *
 *   ACCESS TOKEN   a signed JWT, ~15 minutes, never stored server-side.
 *                  Cheap to check — no database round trip on every request.
 *
 *   REFRESH TOKEN  a random secret, ~30 days, whose HASH is stored in
 *                  `auth.refresh_tokens`. Deleting or revoking that row ends the
 *                  session, which is what makes logout real.
 *
 * The worst case is therefore a ~15 minute window after revocation, not forever.
 *
 * ⚠️ A JWT is SIGNED, NOT ENCRYPTED. Anyone holding one can read its payload.
 * The signature stops them changing it, not reading it — so the payload carries
 * identity only, never anything secret.
 */

import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

/** What the access token carries. Deliberately small — it rides every request. */
export interface AccessTokenClaims {
  /** User id. `sub` is the standard JWT claim for the subject. */
  sub: string
  email: string
  role: string
}

/** Cookie names. */
export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  options: { secret: string; ttlSeconds: number; now: Date },
): Promise<string> {
  const issuedAt = Math.floor(options.now.getTime() / 1000)

  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + options.ttlSeconds)
    .sign(secretKey(options.secret))
}

/**
 * Verifies an access token.
 *
 * Returns null rather than throwing for ANY failure — expired, tampered with,
 * wrong signature, malformed. The caller turns that into a 401, and the client
 * learns nothing about which it was. Distinguishing them would help an attacker
 * probe the implementation.
 */
export async function verifyAccessToken(
  token: string,
  options: { secret: string; now: Date },
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(options.secret), {
      algorithms: ['HS256'],
      currentDate: options.now,
    })

    return toClaims(payload)
  } catch {
    return null
  }
}

function toClaims(payload: JWTPayload): AccessTokenClaims | null {
  const { sub, email, role } = payload

  if (typeof sub !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
    return null
  }

  return { sub, email, role }
}

/**
 * Mints a refresh token.
 *
 * Returns the raw value (sent to the browser, never stored) and its hash (stored
 * in the database, never sent). Same reasoning as password hashing: a stolen
 * database backup must not hand over working sessions.
 *
 * SHA-256 rather than argon2 here on purpose. Argon2's slowness defends against
 * guessing a human-chosen password; this value is 256 bits of randomness and
 * cannot be guessed, so a fast hash is correct — and it is checked on every
 * refresh.
 */
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
