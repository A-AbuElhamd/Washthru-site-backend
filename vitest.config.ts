import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration.
 *
 * THE SPLIT, AND WHY IT MATTERS
 * -----------------------------
 * Vitest runs test FILES in parallel by default. That is normally what you
 * want — but from Session 2 the integration tests share one PostgreSQL test
 * database and clear every table before each test. Run those in parallel and
 * file A wipes file B's rows mid-test, producing failures that move around
 * between runs.
 *
 * Flaky tests get ignored. Ignored tests catch nothing. So this is the single
 * setting that decides whether the suite is trustworthy.
 *
 * Rather than disabling parallelism globally — which would slow every test —
 * the suite is split into two projects:
 *
 *   unit         everything else, parallel, fast
 *   integration  *.db.test.ts, sequential, touches the database
 *
 * Only the tests that need the constraint pay for it.
 */
export default defineConfig({
  test: {
    // Root-level, because it is one of the options `ProjectConfig` excludes.
    // Needed until Session 2 adds the first `*.db.test.ts`; without it the run
    // fails because the `integration` project currently matches no files.
    // Safe to remove once integration tests exist.
    passWithNoTests: true,

    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          // Database tests belong to the other project.
          exclude: ['tests/**/*.db.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.db.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],

          // One file at a time — they share a database.
          //
          // ⚠️ Vitest's own docs describe `fileParallelism: false` for this, but
          // that key is ROOT-ONLY: `ProjectConfig` is defined as
          // `Omit<InlineConfig, NonProjectOptions | ...>`, and both
          // `fileParallelism` and `maxWorkers` live in `NonProjectOptions`.
          // Setting either inside a project block is a type error.
          //
          // `poolOptions.forks.singleFork` is the supported per-project
          // equivalent (verified against vitest 3.2.7's type definitions): it
          // runs every file in this project inside one forked process, so they
          // execute sequentially and cannot clear each other's tables mid-test.
          poolOptions: {
            forks: { singleFork: true },
          },
        },
      },
    ],
  },
})
