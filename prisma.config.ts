/**
 * Prisma CLI configuration.
 *
 * New in Prisma 7: the connection URL is no longer allowed in the datasource
 * block of `schema.prisma`. It lives here instead, and this file is what
 * `prisma migrate`, `prisma studio` and `prisma db pull` read.
 *
 * The RUNTIME client is configured separately, in `src/prisma.ts`, via a driver
 * adapter. Two places, two different jobs:
 *
 *   this file        the CLI, on your machine and in CI
 *   src/prisma.ts    the running application
 *
 * Note this reads `DATABASE_URL` — the development database. Tests use
 * `DATABASE_URL_TEST`; see `tests/helpers/database.ts`.
 */

import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
