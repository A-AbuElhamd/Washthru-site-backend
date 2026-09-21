/**
 * Process entry point — the ONLY file that opens a network port.
 *
 * Everything else builds the application; this starts it. That separation is
 * what makes the app testable (see `src/app.ts`), so resist the very common
 * urge to move `listen` into `app.ts`.
 *
 * This is also where production dependencies are wired. Tests wire their own in
 * `tests/factory.ts`; the application never knows which set it received.
 */

import { createApp } from './app.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { createPrismaClient } from './prisma.js'
import type { Deps } from './deps.js'

/** Seconds to allow in-flight requests to finish before forcing exit. */
const SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Production wiring.
 *
 * When Prisma and Blob Storage arrive (Sessions 2 and 7) they are constructed
 * here — always the real ones. The fakes exist only inside the test factory and
 * never ship.
 */
const prisma = createPrismaClient(config.databaseUrl)

// Route Prisma's own warnings and errors through Winston, so they carry the
// same structure and redaction as everything else rather than going straight to
// stdout in Prisma's format.
prisma.$on('warn', (event) => logger.warn('prisma', { message: event.message }))
prisma.$on('error', (event) => logger.error('prisma', { message: event.message }))

const deps: Deps = {
  config,
  logger,
  prisma,
  clock: () => new Date(),
}

const app = createApp(deps)

const server = app.listen(config.port, () => {
  logger.info('server started', {
    port: config.port,
    environment: config.nodeEnv,
    corsOrigins: config.corsOrigins,
  })
})

/**
 * Graceful shutdown.
 *
 * Azure App Service sends SIGTERM before stopping an instance (during a deploy
 * or a scale-in). Without handling it, in-flight requests are killed mid-way —
 * which for a POST to the contact form means a lead is lost, the exact problem
 * this backend exists to fix.
 *
 * `server.close()` stops accepting new connections and waits for current ones
 * to finish. The timeout is a backstop for a request that hangs.
 */
function shutdown(signal: string): void {
  logger.info('shutdown signal received', { signal })

  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)

  // Don't let the timer itself keep the process alive.
  forceExit.unref()

  server.close((error) => {
    if (error) {
      logger.error('error during shutdown', { message: error.message })
      process.exit(1)
    }

    // Close the connection pool after the HTTP server, so in-flight requests
    // can finish their queries first.
    void prisma
      .$disconnect()
      .catch((disconnectError: unknown) => {
        logger.error('error disconnecting from database', {
          message: disconnectError instanceof Error ? disconnectError.message : String(disconnectError),
        })
      })
      .finally(() => {
        logger.info('shutdown complete')
        process.exit(0)
      })
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

/**
 * Last-resort handlers.
 *
 * An unhandled rejection or uncaught exception means the process is in an
 * unknown state. Log it properly — this is the one record of what happened —
 * then exit so the platform restarts a clean instance. Carrying on risks
 * serving corrupt data from a process that has already failed.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  shutdown('unhandledRejection')
})

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', {
    message: error.message,
    stack: error.stack,
  })
  shutdown('uncaughtException')
})
