/**
 * Builds the Express application.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ----------------------------------------
 * `createApp` builds the app and returns it. It NEVER calls `.listen()`.
 * Only `server.ts` does that.
 *
 * Almost every Express tutorial ends with `app.listen(3000)` in this file, and
 * an app that starts itself cannot be handed to a test. Keeping the two apart
 * is what lets `tests/factory.ts` build the same application with substituted
 * dependencies — the Node equivalent of .NET's `WebApplicationFactory` plus
 * `ConfigureTestServices`.
 *
 * Middleware order matters and is deliberate; each step below says why.
 */

import express, { type Express } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import type { Deps } from './deps.js'
import { authRoutes } from './routes/auth.js'
import { requireAuth } from './auth/middleware.js'
import { requestId } from './middleware/requestId.js'
import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { healthRoutes } from './routes/health.js'
import { createCrudRouter } from './crud/router.js'
import { resources } from './resources/index.js'

/** Largest JSON body accepted. Blog and news bodies carry full HTML articles. */
const JSON_BODY_LIMIT = '1mb'

export function createApp(deps: Deps): Express {
  const app = express()

  // 1. Trust the reverse proxy.
  //
  //    ⚠️ Without this, everything behind Azure App Service sees the proxy's IP
  //    instead of the real client's, because the true address arrives in the
  //    `X-Forwarded-For` header. The IP rate limiter on the public contact form
  //    (decision #18) would then treat every visitor on earth as one client —
  //    blocking everyone after five submissions, or nobody. It fails silently,
  //    which is what makes it easy to miss.
  //
  //    `1` means "trust exactly one proxy hop", which is what App Service is.
  //    Trusting all proxies would let a client forge its own IP via the header.
  app.set('trust proxy', 1)

  // 2. Don't advertise the framework. Free, and one less hint for an attacker.
  app.disable('x-powered-by')

  // 3. Request id + bound logger, before anything that might log or fail — so
  //    every later line, including errors, carries the id.
  app.use(requestId(deps.logger))

  // 4. CORS (decision #18).
  //
  //    An explicit allowlist, never a wildcard. This is not a preference:
  //    the JWT lives in a cookie, which makes every request credentialed, and
  //    browsers reject `Access-Control-Allow-Origin: *` on credentialed
  //    requests. `credentials: true` is required or the cookie never arrives.
  app.use(
    cors({
      origin: deps.config.corsOrigins,
      credentials: true,
      // `X-Request-Id` is exposed so the dashboard can read it back and show it
      // in an error report.
      exposedHeaders: ['X-Request-Id'],
    }),
  )

  // 5. Parse JSON bodies. A malformed body throws here and is converted into
  //    the standard error envelope by `errorHandler` below.
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  //    Parse cookies — this is how the auth tokens arrive (decision #12). They
  //    are httpOnly, so they never appear in a request body or header we set.
  app.use(cookieParser())

  // 6. Log completed requests — method, path, status, duration. Never bodies
  //    or headers; see `requestLogger` for why.
  app.use(requestLogger())

  // 7. Routes.
  //
  //    PUBLIC — no token required:
  //      /api/health   the platform's probe has no credentials
  //      /api/auth/*   you cannot log in with a token you do not have yet
  app.use('/api', healthRoutes(deps))
  app.use('/api/auth', authRoutes(deps))

  //    PROTECTED — everything below requires a valid access token.
  //
  //    `requireAuth` is applied ONCE here, in front of the whole loop, rather
  //    than route by route. That is deliberate: auth in Express is opt-in, and a
  //    new endpoint added without it is silently public. Attaching it at the
  //    mount point means a new resource registration is protected by default
  //    instead of by remembering.
  //
  //    `tests/auth.db.test.ts` enumerates every route and asserts each returns
  //    401 without a token, so a regression here fails loudly.
  for (const resource of resources) {
    app.use(`/api/${resource.path}`, requireAuth(deps), createCrudRouter(resource, deps))
  }

  // 8. Nothing matched — produce the standard envelope rather than Express's
  //    default HTML 404 page.
  app.use(notFoundHandler)

  // 9. Error handler. MUST be last: Express only routes errors to middleware
  //    registered after the routes that produce them.
  app.use(errorHandler())

  return app
}
