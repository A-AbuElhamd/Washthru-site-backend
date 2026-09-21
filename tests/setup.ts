/**
 * Test setup, run once per test file before anything else.
 *
 * Its only job is loading `.env`.
 *
 * `src/config.ts` does `import 'dotenv/config'` itself, but that only helps
 * modules that go through it. `tests/helpers/database.ts` reads
 * `DATABASE_URL_TEST` from `process.env` directly, and Vitest does not load
 * `.env` on its own — so without this, integration tests fail with
 * "DATABASE_URL_TEST is not set" even though it is sitting right there in the
 * file.
 */

import 'dotenv/config'
