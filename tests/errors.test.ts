/**
 * Pins the error envelope from decision #18.
 *
 * Worth testing early: the dashboard writes its error handling once against
 * this shape. If the envelope drifts, every error path in the dashboard breaks
 * at once — and quietly, because a changed shape still returns 200-shaped JSON
 * to anything not checking carefully.
 */

import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTestApp, createTestDeps } from './factory.js'
import { requestId } from '../src/middleware/requestId.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { notFound, validationFailed, AppError } from '../src/errors.js'

describe('error envelope', () => {
  it('returns the standard shape for an unknown endpoint', async () => {
    const app = createTestApp()

    const response = await request(app).get('/api/does-not-exist').expect(404)

    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'That endpoint does not exist',
      },
    })
  })

  it('includes a per-field list for validation failures', () => {
    const error = validationFailed([
      { field: 'titleAr', message: 'Arabic title is required' },
      { field: 'slug', message: 'Slug is required' },
    ])

    expect(error.statusCode).toBe(400)
    expect(error.toBody()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Check the highlighted fields',
        fields: [
          { field: 'titleAr', message: 'Arabic title is required' },
          { field: 'slug', message: 'Slug is required' },
        ],
      },
    })
  })

  it('omits `fields` entirely when there are none', () => {
    // The dashboard checks for the key's presence, so an empty array or a
    // `fields: undefined` would both be wrong.
    expect(notFound().toBody()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found' },
    })
  })

  it('rejects a malformed JSON body with the standard envelope', async () => {
    const app = createTestApp()

    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{ this is not json')

    // Express's body parser throws; the point is that it comes back in OUR
    // shape rather than Express's default HTML error page.
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.body).toHaveProperty('error.code')
    expect(response.body).toHaveProperty('error.message')
  })
})

describe('unexpected errors', () => {
  /**
   * Builds a minimal app with one route that throws, wired with the REAL
   * `requestId` and `errorHandler` middleware.
   *
   * Why not mount a throwing route onto `createTestApp()`: an error thrown in a
   * parent app never reaches a sub-app's error handler, so that approach ends
   * up exercising Express's default HTML handler rather than ours.
   *
   * The throw is inside an `async` handler deliberately. Under Express 4 this
   * would hang the request forever rather than reaching the error handler —
   * which is exactly why decision #9 specifies Express 5. If this test ever
   * times out instead of failing, that is the regression to look for.
   */
  function appWithThrowingRoute(thrown: unknown): express.Express {
    const deps = createTestDeps()
    const app = express()
    app.use(requestId(deps.logger))
    app.get('/boom', async () => {
      throw thrown
    })
    app.use(errorHandler())
    return app
  }

  it('does not leak internal detail from an unexpected error', async () => {
    const app = appWithThrowingRoute(
      new Error('connection string postgres://user:hunter2@host/db failed'),
    )

    const response = await request(app).get('/boom').expect(500)

    expect(response.body.error.code).toBe('INTERNAL_ERROR')
    // The message must NOT contain internal detail — that would expose
    // credentials, file paths or SQL to the client.
    expect(response.body.error.message).not.toContain('postgres://')
    expect(response.body.error.message).not.toContain('hunter2')
    // It carries the request id so a user can quote it when reporting.
    expect(response.body.error.message).toMatch(/Reference: /)
  })

  it('passes an AppError through with its own status and message', async () => {
    const app = appWithThrowingRoute(
      new AppError(409, 'CONFLICT', 'A product with that slug already exists'),
    )

    const response = await request(app).get('/boom').expect(409)

    expect(response.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'A product with that slug already exists',
      },
    })
  })

  it('handles a non-Error being thrown', async () => {
    // Nothing stops `throw 'a string'`, and the handler must not crash on it.
    const app = appWithThrowingRoute('just a string')

    const response = await request(app).get('/boom').expect(500)

    expect(response.body.error.code).toBe('INTERNAL_ERROR')
  })
})
