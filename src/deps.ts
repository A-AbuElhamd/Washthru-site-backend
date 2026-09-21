/**
 * The application's dependencies — everything `createApp` needs from the
 * outside world.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the Node equivalent of ASP.NET Core's service registration, and it is
 * what makes `ConfigureTestServices`-style substitution possible.
 *
 * In .NET you can override any registered service after the fact, because the
 * framework resolves everything through a DI container. **Express has no
 * container.** So substitution has to be designed in: anything a test might
 * want to replace must travel through this interface.
 *
 * The consequence, stated plainly so it is not a surprise later: you can only
 * swap what is listed here. Forget to include the clock and a test cannot fake
 * time without editing application code first. That is a ten-minute fix — add a
 * field, pass it down — not a rewrite, but it is the reason to be deliberate
 * about what belongs in this interface.
 *
 * Production wiring lives in `server.ts`. Test wiring lives in
 * `tests/factory.ts`. The app itself never knows which it got.
 */

import type { AppPrismaClient } from './prisma.js'
import type { Config } from './config.js'
import type { Logger } from './logger.js'

export interface Deps {
  /** Validated configuration. Tests pass a synthetic one. */
  config: Config

  /** Root logger. Per-request child loggers are derived from it. */
  logger: Logger

  /**
   * Database access.
   *
   * Tests get a client pointed at the TEST database — a real PostgreSQL, never
   * a mock. The schema's rules live in the database (partial unique indexes,
   * native enums, jsonb, cascades), so a mocked client would return whatever it
   * was told to and a suite could pass green while the constraints were broken.
   */
  prisma: AppPrismaClient

  /**
   * Current time, as a function rather than a direct `new Date()` call.
   *
   * Every piece of code that needs "now" takes it from here, so a test can
   * freeze time — needed for token expiry, `published_at` comparisons and
   * anything date-sensitive. Calling `new Date()` directly inside a handler
   * would make those tests depend on the wall clock and fail intermittently.
   */
  clock: () => Date

  // --- Added in later sessions -------------------------------------------
  // blob: BlobStore  — Session 7. Faked in tests (temp folder), real Azure in
  //                    production; `server.ts` always wires the real one.
}
