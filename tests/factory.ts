/**
 * The test application factory.
 *
 * This is the Node equivalent of ASP.NET Core's `WebApplicationFactory<Program>`
 * plus `ConfigureTestServices`. Side by side:
 *
 *   // .NET
 *   factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => {
 *       s.RemoveAll<IBlobStore>();
 *       s.AddSingleton<IBlobStore, FakeBlobStore>();
 *   })).CreateClient();
 *
 *   // here
 *   const app = createTestApp({ blob: fakeBlobStore() })
 *   await request(app).post('/api/media').expect(201)
 *
 * Supertest plays the part of `CreateClient()` — it takes the app object and
 * makes real HTTP requests against it without binding a port.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * Real: the Express app itself (the same one `server.ts` runs), its middleware,
 * routing, error handling, HTTP, Joi, and — from Session 2 — PostgreSQL, with
 * its actual constraints, enums and indexes.
 *
 * Faked: Azure Blob Storage (Session 7). Silenced: the logger. Frozen: the clock.
 *
 * That is one faked external system. The fake is test-only: `server.ts` always
 * wires the real Azure client, so production uploads hit real Azure from day one.
 */

import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { loadConfig, type Config } from '../src/config.js'
import { createLogger } from '../src/logger.js'
import type { Deps } from '../src/deps.js'
import { getTestDatabaseUrl, getTestPrisma } from './helpers/database.js'

/**
 * A fixed point in time for tests.
 *
 * Anything date-sensitive — token expiry, `published_at` comparisons — is
 * asserted against this rather than the wall clock, so tests do not fail
 * intermittently at midnight or across a daylight-saving boundary.
 */
export const TEST_NOW = new Date('2026-01-01T12:00:00.000Z')

/**
 * Configuration for tests, built from an explicit environment rather than the
 * developer's real one. A stray `.env` value cannot change test behaviour.
 */
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'error',
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
    // Always the TEST database. `getTestDatabaseUrl` refuses any connection
    // string whose database name does not end in `_test`, so a mistyped
    // variable cannot point the truncating helpers at real data.
    DATABASE_URL: getTestDatabaseUrl(),
    // A fixed, obviously-fake signing secret. Tests must not depend on the
    // developer's real one, and a token signed here must not be valid anywhere.
    JWT_SECRET: 'test-only-signing-secret-not-used-anywhere-real-000000',
  })

  return Object.freeze({ ...base, ...overrides })
}

/**
 * Builds the dependency set used by tests.
 *
 * Exported separately from `createTestApp` for tests that need to inspect or
 * assert on a dependency as well as pass it in.
 */
export function createTestDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    config: createTestConfig(),
    // Silent: otherwise every test run floods the terminal. Swap in a real
    // logger via overrides when debugging a specific test.
    logger: createLogger({ level: 'error', silent: true, pretty: false }),
    // A REAL client against the real test database — never a mock. See
    // tests/helpers/database.ts for why.
    prisma: getTestPrisma(),
    clock: () => TEST_NOW,
    ...overrides,
  }
}

/**
 * Builds the application with test dependencies.
 *
 * Pass `overrides` to replace individual dependencies — the equivalent of
 * `ConfigureTestServices`. Everything not overridden stays as the test default:
 *
 *   const app = createTestApp()                              // all defaults
 *   const app = createTestApp({ clock: () => otherDate })     // fake time
 *   const app = createTestApp({ config: createTestConfig({ corsOrigins: [] }) })
 */
export function createTestApp(overrides: Partial<Deps> = {}): Express {
  return createApp(createTestDeps(overrides))
}
