/**
 * Schema / migration test.
 *
 * Proves the database Prisma actually built matches the design, against a REAL
 * PostgreSQL. Small, fast, and it catches a whole class of failure: a schema
 * that only works on the machine it was written on.
 *
 * With three schemas, 12 native enums and partial unique indexes behind a
 * preview flag, "it validated" is not the same as "it built correctly" — a
 * point already proven during Session 2, when partial index support turned out
 * to need a preview feature that `prisma validate` never mentioned.
 *
 * Note the `.db.test.ts` suffix: vitest.config.ts routes these into the
 * `integration` project, which runs files one at a time because they share a
 * database.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  clearAllTables,
  countTables,
  disconnectTestPrisma,
  getTestPrisma,
  assertIsTestDatabase,
} from './helpers/database.js'

const prisma = getTestPrisma()

beforeEach(async () => {
  await clearAllTables(prisma)
})

afterAll(async () => {
  await disconnectTestPrisma()
})

describe('database schema', () => {
  it('has all 28 tables', async () => {
    expect(await countTables(prisma)).toBe(28)
  })

  it('splits them across the three schemas as designed', async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_schema: string; count: bigint }[]>(
      `SELECT table_schema, count(*) AS count
         FROM information_schema.tables
        WHERE table_schema IN ('cms', 'ops', 'auth')
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        GROUP BY table_schema`,
    )

    const counts = Object.fromEntries(rows.map((r) => [r.table_schema, Number(r.count)]))

    // The split is the least-privilege boundary from decision #6, so the shape
    // matters, not just the total.
    expect(counts).toEqual({ auth: 2, cms: 24, ops: 2 })
  })

  it('created all 12 native enum types', async () => {
    const rows = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT t.typname
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e'
          AND n.nspname IN ('cms', 'ops', 'auth')
        ORDER BY t.typname`,
    )

    expect(rows.map((r) => r.typname)).toEqual([
      'audit_action',
      'blueprint_plan_type',
      'blueprint_street_config',
      'contact_request_type',
      'content_status',
      'locale',
      'media_kind',
      'news_category',
      'product_category',
      'service_icon',
      'user_role',
      'value_icon',
    ])
  })

  it('kept the kebab-case enum values the frontend uses', async () => {
    // Prisma identifiers cannot contain dashes, so these go through @map. If
    // that mapping were lost, every existing content file would fail to import.
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT e.enumlabel AS value
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'news_category'
        ORDER BY e.enumsortorder`,
    )

    expect(rows.map((r) => r.value)).toEqual([
      'product-launches',
      'partnerships-contracts',
      'exhibitions-events',
      'achievements-expansions',
      'in-media',
    ])
  })

  it('created all 5 partial unique indexes', async () => {
    // The ones that make soft delete work: a deleted row must stop reserving
    // its slug (rule 4). These are a PREVIEW feature in Prisma 7.10 — exactly
    // the kind of thing that can silently stop being emitted on an upgrade.
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname IN ('cms', 'ops', 'auth')
          AND indexdef LIKE '%WHERE (deleted_at IS NULL)%'
        ORDER BY indexname`,
    )

    expect(rows.map((r) => r.indexname)).toEqual([
      'blog_posts_slug_active_key',
      'blueprint_plans_slug_locale_active_key',
      'news_articles_slug_active_key',
      'products_slug_active_key',
      'users_email_active_key',
    ])
  })
})

describe('clearAllTables safety guard', () => {
  it('refuses a database whose name does not end in _test', () => {
    // The guard that stands between a mistyped variable and a developer's real
    // content being deleted.
    expect(() =>
      assertIsTestDatabase('postgresql://user:pw@localhost:5001/washthru_dev'),
    ).toThrow(/Refusing to run destructive test helpers/)
  })

  it('accepts a proper test database', () => {
    expect(() =>
      assertIsTestDatabase('postgresql://user:pw@localhost:5001/washthru_test'),
    ).not.toThrow()
  })
})
