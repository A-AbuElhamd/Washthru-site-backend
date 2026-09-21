/**
 * Health endpoint.
 *
 * Azure App Service and most deployment tooling poll a URL like this to decide
 * whether an instance is alive and should receive traffic. It must be:
 *
 *  - unauthenticated (the prober has no credentials)
 *  - cheap (it is called constantly)
 *  - honest (it must fail when the service genuinely cannot serve requests)
 *
 * That last point is why this checks the database. An instance that cannot reach
 * PostgreSQL cannot serve a single useful request, and reporting 200 in that
 * state means Azure keeps routing traffic to a process that will fail every one.
 */

import { Router } from 'express'
import type { Deps } from '../deps.js'

/** Statuses used so the two branches read clearly at the call site. */
const OK = 200
const SERVICE_UNAVAILABLE = 503

export function healthRoutes(deps: Deps): Router {
  const router = Router()

  router.get('/health', async (req, res) => {
    // `SELECT 1` is the cheapest possible proof that a connection can be
    // acquired from the pool and a round trip completes.
    let databaseOk = true
    try {
      await deps.prisma.$queryRaw`SELECT 1`
    } catch (error) {
      databaseOk = false
      req.log.error('health check: database unreachable', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    res.status(databaseOk ? OK : SERVICE_UNAVAILABLE).json({
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'up' : 'down',
      // `clock` rather than `new Date()` so tests can assert an exact value.
      timestamp: deps.clock().toISOString(),
      environment: deps.config.nodeEnv,
    })
  })

  return router
}
