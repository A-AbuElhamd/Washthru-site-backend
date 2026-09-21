/**
 * Password hashing.
 *
 * Uses **argon2id**, the current OWASP first choice. It is deliberately slow and
 * memory-hard, which is the whole point: a stolen database of hashes should be
 * expensive to attack offline, and memory-hardness removes the advantage an
 * attacker gets from GPUs.
 *
 * Never store, log, or return a password. The only things that leave this module
 * are an opaque hash and a boolean.
 */

import argon2 from 'argon2'

/**
 * Parameters. Defaults from the argon2 library are sensible; these are stated
 * explicitly so a future change is a visible decision rather than a silent
 * consequence of upgrading a dependency.
 *
 * Roughly 64 MB and 3 passes — comfortably fast for a login (tens of
 * milliseconds) and painful at scale for an attacker.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS)
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash. A corrupt row should
 * fail the login, not crash the endpoint — and the caller cannot tell the
 * difference anyway, which is intentional.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext)
  } catch {
    return false
  }
}
