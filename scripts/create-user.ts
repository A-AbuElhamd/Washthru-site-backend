/**
 * Creates a dashboard user.
 *
 * There is deliberately no public signup endpoint — this is an internal admin
 * tool, and accounts are created by whoever runs the server. So this script is
 * how the first user comes into existence, and how later ones are added until a
 * user-management screen exists.
 *
 *   pnpm create-user <email> <password> [name] [admin|editor]
 *
 * Example:
 *   pnpm create-user ahmed@washthru.com "a good long password" "Ahmed" admin
 *
 * The password is hashed with argon2id before it touches the database — the
 * plaintext is never stored and never logged.
 */

import 'dotenv/config'
import { createPrismaClient } from '../src/prisma.js'
import { hashPassword } from '../src/auth/password.js'

/** Short passwords are the weakest link in the whole auth design. */
const MIN_PASSWORD_LENGTH = 12

async function main(): Promise<void> {
  const [email, password, name = 'Admin', role = 'admin'] = process.argv.slice(2)

  if (!email || !password) {
    console.error(`
Usage: pnpm create-user <email> <password> [name] [admin|editor]

Example:
  pnpm create-user ahmed@washthru.com "a good long password" "Ahmed" admin
`)
    process.exit(1)
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exit(1)
  }

  if (role !== 'admin' && role !== 'editor') {
    console.error('Role must be "admin" or "editor".')
    process.exit(1)
  }

  // Lowercase on write. The unique index is case-sensitive, so storing
  // "Ahmed@..." would create an account that can never be logged into — login
  // lowercases before looking up.
  const normalisedEmail = email.toLowerCase().trim()

  const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '')

  try {
    const existing = await prisma.user.findFirst({
      where: { email: normalisedEmail, deletedAt: null },
    })

    if (existing) {
      console.error(`A user with ${normalisedEmail} already exists.`)
      process.exit(1)
    }

    const user = await prisma.user.create({
      data: {
        email: normalisedEmail,
        name,
        role,
        passwordHash: await hashPassword(password),
      },
    })

    console.log(`\n✓ Created ${user.role} "${user.name}" <${user.email}>`)
    console.log(`  id: ${user.id}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

await main()
