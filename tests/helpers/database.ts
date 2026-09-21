/**
 * Test database helpers.
 *
 * Integration tests run against a REAL PostgreSQL (decision #17), not a mock.
 * The schema's rules live in the database — partial unique indexes, native
 * enums, jsonb, cascades — so a mocked client would return whatever it was told
 * to, and the suite could pass green while the constraints were broken.
 *
 * ⚠️ SAFETY
 * ---------
 * `clearAllTables()` deletes everything. It is pointed at `DATABASE_URL_TEST`,
 * never `DATABASE_URL`, and `assertIsTestDatabase` below refuses to run against
 * anything whose database name does not end in `_test`. Wiping a developer's
 * real data because of one mistyped variable is a very easy accident, and one
 * guard costs nothing.
 */

import { createPrismaClient, type AppPrismaClient } from '../../src/prisma.js'

/**
 * Reads the test connection string.
 *
 * Deliberately does NOT fall back to `DATABASE_URL`. A fallback would mean a
 * missing variable silently truncates the development database.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL_TEST']

  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Integration tests need their own database — ' +
        'they delete every row before each test. Copy .env.example to .env and set it.',
    )
  }

  assertIsTestDatabase(url)
  return url
}

/**
 * Refuses any connection string that does not clearly name a test database.
 *
 * The check is on the database name at the end of the URL. Crude, but it is the
 * difference between "tests failed" and "the afternoon's content is gone".
 */
export function assertIsTestDatabase(url: string): void {
  // Strip query string, then take the last path segment.
  const withoutQuery = url.split('?')[0] ?? ''
  const databaseName = withoutQuery.split('/').pop() ?? ''

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive test helpers against database "${databaseName}". ` +
        'The test database name must end in "_test".',
    )
  }
}

let client: AppPrismaClient | undefined

/**
 * The shared test client.
 *
 * One client for the whole run rather than one per test: connecting is the slow
 * part, and the integration project runs its files sequentially anyway
 * (`poolOptions.forks.singleFork` in vitest.config.ts).
 */
export function getTestPrisma(): AppPrismaClient {
  client ??= createPrismaClient(getTestDatabaseUrl())
  return client
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = undefined
  }
}

/** Tables that must never be truncated — Prisma's own migration bookkeeping. */
const PROTECTED_TABLES = new Set(['_prisma_migrations'])

/**
 * Empties every table in `cms`, `ops` and `auth`.
 *
 * Runs as ONE `TRUNCATE` statement covering all tables, which matters for two
 * reasons: it is dramatically faster than deleting table by table, and
 * `CASCADE` resolves the foreign keys between them without needing to work out
 * a safe deletion order by hand.
 *
 * The table list is read from `information_schema` rather than hardcoded, so
 * tables added in later sessions are picked up automatically — a hardcoded list
 * would silently stop clearing new tables and leave data bleeding between tests.
 */
export async function clearAllTables(prisma: AppPrismaClient = getTestPrisma()): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ schemaname: string; tablename: string }[]>(
    `SELECT schemaname, tablename
       FROM pg_tables
      WHERE schemaname IN ('cms', 'ops', 'auth')`,
  )

  const targets = rows
    .filter((row) => !PROTECTED_TABLES.has(row.tablename))
    .map((row) => `"${row.schemaname}"."${row.tablename}"`)

  if (targets.length === 0) return

  // RESTART IDENTITY resets any sequences; CASCADE handles the foreign keys.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.join(', ')} RESTART IDENTITY CASCADE`,
  )
}

/** Counts the base tables Prisma created, used by the migration test. */
export async function countTables(prisma: AppPrismaClient = getTestPrisma()): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count
       FROM information_schema.tables
      WHERE table_schema IN ('cms', 'ops', 'auth')
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'`,
  )

  return Number(rows[0]?.count ?? 0)
}
