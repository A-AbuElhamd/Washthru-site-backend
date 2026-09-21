/**
 * The first test — proves the whole harness works end to end:
 * `createTestApp` builds the real application, Supertest drives it over real
 * HTTP, and dependency substitution does what it claims.
 *
 * It looks trivial, and that is the point: if this passes, the foundation every
 * later session builds on is sound.
 */

import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp, TEST_NOW } from './factory.js'

describe('GET /api/health', () => {
  it('reports the service is up', async () => {
    const app = createTestApp()

    const response = await request(app).get('/api/health').expect(200)

    expect(response.body).toMatchObject({
      status: 'ok',
      environment: 'test',
    })
  })

  it('uses the injected clock rather than the wall clock', async () => {
    const app = createTestApp()

    const response = await request(app).get('/api/health').expect(200)

    // Proves `deps.clock` is genuinely wired through: the handler reports the
    // frozen test time, not `new Date()`. Without this, every date-sensitive
    // test later (token expiry, published_at) would silently depend on the
    // real clock.
    expect(response.body.timestamp).toBe(TEST_NOW.toISOString())
  })

  it('can have a single dependency swapped, leaving the rest real', async () => {
    // This is the `ConfigureTestServices` equivalent — the reason the whole
    // createApp(deps) structure exists.
    const otherTime = new Date('2030-06-15T08:30:00.000Z')
    const app = createTestApp({ clock: () => otherTime })

    const response = await request(app).get('/api/health').expect(200)

    expect(response.body.timestamp).toBe(otherTime.toISOString())
    // Everything not overridden is untouched.
    expect(response.body.environment).toBe('test')
  })

  it('returns a request id header', async () => {
    const app = createTestApp()

    const response = await request(app).get('/api/health').expect(200)

    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it('echoes a caller-supplied request id so a trace can span services', async () => {
    const app = createTestApp()

    const response = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'dashboard-abc-123')
      .expect(200)

    expect(response.headers['x-request-id']).toBe('dashboard-abc-123')
  })

  it('rejects a malformed caller-supplied request id and mints its own', async () => {
    const app = createTestApp()

    // A hostile client should not be able to inject newlines into the logs.
    const response = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'bad id with spaces')
      .expect(200)

    expect(response.headers['x-request-id']).not.toBe('bad id with spaces')
    expect(response.headers['x-request-id']).toBeTruthy()
  })
})
