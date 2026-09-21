/**
 * The Prisma client — how the application talks to PostgreSQL.
 *
 * WHY THIS FILE LOOKS DIFFERENT FROM EVERY TUTORIAL
 * -------------------------------------------------
 * Prisma 7 removed `url` from the datasource block in `schema.prisma`. A client
 * is now constructed with a **driver adapter** — a real PostgreSQL connection
 * pool that Prisma runs its queries through — instead of Prisma being handed a
 * connection string and managing the connection itself.
 *
 * So there are two separate places connection details live, doing two different
 * jobs:
 *
 *   prisma.config.ts   the CLI: migrate, studio, db pull
 *   this file          the running application
 *
 * Nearly all material online still shows `url = env("DATABASE_URL")` inside
 * `schema.prisma`, which fails outright on Prisma 7 with error P1012.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * Builds a Prisma client for a given connection string.
 *
 * Takes the URL as an argument rather than reading `process.env` directly, so
 * tests can point a client at the TEST database without touching the
 * development one. That distinction matters here more than usual: the test
 * helper truncates every table before each test, and pointing it at the wrong
 * database would silently erase real work.
 *
 * NOTE: the return type is deliberately left to inference. Prisma encodes the
 * configured log events in the client's type, so annotating this as the bare
 * `PrismaClient` would erase them and `$on('warn', …)` would stop type-checking.
 */
export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: databaseUrl })

  return new PrismaClient({
    adapter,
    // Surface database problems through Winston rather than Prisma's own stdout
    // writer, so they carry our structure and obey the redaction rules.
    //
    // `query` is deliberately absent: query logs include parameter values, which
    // for `ops.contact_submissions` means customer phone numbers and email
    // addresses (decision #15, rule 3).
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  })
}

/**
 * The client type used throughout the application.
 *
 * Derived from `createPrismaClient` rather than imported from `@prisma/client`
 * so it keeps the log-event typing described above.
 */
export type AppPrismaClient = ReturnType<typeof createPrismaClient>
