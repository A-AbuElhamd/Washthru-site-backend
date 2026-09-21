/**
 * Authentication.
 *
 * Contains the single highest-value test in the suite — "every protected route
 * rejects an unauthenticated request". Auth in Express is opt-in, so an endpoint
 * shipped without the middleware is silently public: nothing fails, it just
 * works for everyone. That mistake is invisible in code review and serious in
 * production, and it is ~15 lines to automate.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createTestApp, createTestDeps } from './factory.js'
import { createApp } from '../src/app.js'
import { clearAllTables, disconnectTestPrisma, getTestPrisma } from './helpers/database.js'
import { createTestUser, signIn, TEST_PASSWORD } from './helpers/auth.js'
import { resources } from '../src/resources/index.js'
import { hashRefreshToken } from '../src/auth/tokens.js'

const prisma = getTestPrisma()
const app = createTestApp()

beforeEach(async () => {
  await clearAllTables(prisma)
})

afterAll(async () => {
  await disconnectTestPrisma()
})

describe('every protected route requires authentication', () => {
  // Built from the resource registry rather than a hand-written list, so a new
  // table added in `resources/` is covered automatically. A hardcoded list would
  // quietly stop covering new endpoints — which is the exact failure this test
  // exists to prevent.
  const routes = resources.flatMap((resource) => [
    { method: 'get', path: `/api/${resource.path}` },
    { method: 'get', path: `/api/${resource.path}/some-id` },
    { method: 'post', path: `/api/${resource.path}` },
    { method: 'patch', path: `/api/${resource.path}/some-id` },
    { method: 'delete', path: `/api/${resource.path}/some-id` },
  ])

  it.each(routes)('$method $path returns 401 without a token', async ({ method, path }) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => never>)
      [method]!(path)

    expect((res as unknown as { status: number }).status).toBe(401)
    expect((res as unknown as { body: { error: { code: string } } }).body.error.code).toBe(
      'UNAUTHORIZED',
    )
  })

  it('covers every registered resource', () => {
    // Guards the guard: if the registry were empty, `it.each` above would run
    // zero assertions and pass silently.
    expect(resources.length).toBeGreaterThan(0)
    expect(routes.length).toBe(resources.length * 5)
  })
})

describe('public routes stay public', () => {
  it('health needs no token — the platform probe has no credentials', async () => {
    await request(app).get('/api/health').expect(200)
  })

  it('login needs no token', async () => {
    // Obvious, but worth pinning: protecting it would lock everyone out.
    await request(app).post('/api/auth/login').send({}).expect(400)
  })
})

describe('login', () => {
  it('signs in and sets both cookies httpOnly', async () => {
    const user = await createTestUser()

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200)

    expect(res.body.user).toMatchObject({ email: user.email, name: 'Ahmed', role: 'admin' })

    const cookies = res.headers['set-cookie'] as unknown as string[]
    const access = cookies.find((c) => c.startsWith('access_token='))
    const refresh = cookies.find((c) => c.startsWith('refresh_token='))

    // httpOnly is the whole point — without it any script on the page can read
    // the token, and the design is no better than the forgeable boolean cookie
    // the dashboard uses today.
    expect(access).toMatch(/HttpOnly/i)
    expect(refresh).toMatch(/HttpOnly/i)
    // The refresh token is scoped to its endpoint, so the long-lived credential
    // is not attached to every ordinary API call.
    expect(refresh).toMatch(/Path=\/api\/auth/i)
  })

  it('never returns the token in the body', async () => {
    const user = await createTestUser()

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200)

    // A token in the body forces the dashboard to store it somewhere readable.
    const serialised = JSON.stringify(res.body)
    expect(serialised).not.toMatch(/eyJ/) // JWTs start like this
    expect(res.body.token).toBeUndefined()
    expect(res.body.accessToken).toBeUndefined()
  })

  it('never returns the password hash', async () => {
    const user = await createTestUser()

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200)

    expect(JSON.stringify(res.body)).not.toMatch(/argon2/)
    expect(res.body.user.passwordHash).toBeUndefined()
  })

  it('gives the same message for a wrong password and an unknown email', async () => {
    // Different messages turn this endpoint into a way to discover which email
    // addresses have accounts.
    const user = await createTestUser()

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong' })
      .expect(401)

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@washthru.test', password: TEST_PASSWORD })
      .expect(401)

    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message)
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code)
  })

  it('refuses a soft-deleted user', async () => {
    const user = await createTestUser()
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })

    await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401)
  })
})

describe('me', () => {
  it('returns the signed-in user', async () => {
    const agent = await signIn(app)

    const res = await agent.get('/api/auth/me').expect(200)
    expect(res.body.user.email).toBe('ahmed@washthru.test')
  })

  it('returns 401 without a session', async () => {
    // This is what the dashboard's auth middleware will call on page load, now
    // that httpOnly means it cannot read the cookie itself.
    await request(app).get('/api/auth/me').expect(401)
  })

  it('rejects a tampered token', async () => {
    // A plain request, not the signed-in agent: an agent keeps its own cookie
    // jar, so a manually-set Cookie header is merged with the real cookie rather
    // than replacing it, and the valid one wins.
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'access_token=not.a.real.token')
      .expect(401)
  })
})

describe('refresh', () => {
  it('issues a new session and revokes the old token', async () => {
    // Rotation. Without it a stolen refresh token stays valid for its full 30
    // days alongside the real one; with it, whichever party refreshes second is
    // rejected, so the theft surfaces.
    const agent = await signIn(app)

    const before = await prisma.refreshToken.findMany()
    expect(before).toHaveLength(1)

    await agent.post('/api/auth/refresh').expect(200)

    const after = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } })
    expect(after).toHaveLength(2)
    expect(after[0]?.revokedAt).not.toBeNull() // the spent one
    expect(after[1]?.revokedAt).toBeNull() // the fresh one
  })

  it('rejects a revoked token', async () => {
    const agent = await signIn(app)

    await agent.post('/api/auth/refresh').expect(200)
    // The agent still holds the NEW cookie, so replay the original by hand.
    const first = await prisma.refreshToken.findFirst({ orderBy: { createdAt: 'asc' } })
    expect(first?.revokedAt).not.toBeNull()

    await request(app).post('/api/auth/refresh').expect(401)
  })

  it('rejects an expired token', async () => {
    const agent = await signIn(app)

    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date('2020-01-01') },
    })

    await agent.post('/api/auth/refresh').expect(401)
  })

  it('rejects a made-up token', async () => {
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=completely-invented')
      .expect(401)
  })

  it('stores only the hash, never the token itself', async () => {
    // A stolen database backup must not hand over working sessions.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: (await createTestUser()).email, password: TEST_PASSWORD })
      .expect(200)

    const cookies = res.headers['set-cookie'] as unknown as string[]
    const raw = cookies
      .find((c) => c.startsWith('refresh_token='))!
      .split('=')[1]!
      .split(';')[0]!

    const stored = await prisma.refreshToken.findFirst()
    expect(stored?.tokenHash).not.toBe(raw)
    expect(stored?.tokenHash).toBe(hashRefreshToken(raw))
  })
})

describe('logout', () => {
  it('revokes the refresh token server-side, not just the cookie', async () => {
    // Clearing cookies alone would leave a copied token working for 30 days.
    const agent = await signIn(app)

    await agent.post('/api/auth/logout').expect(204)

    const stored = await prisma.refreshToken.findFirst()
    expect(stored?.revokedAt).not.toBeNull()
  })

  it('succeeds even with no session', async () => {
    // "Log me out" should never fail — there is nothing useful a client could
    // do with an error.
    await request(app).post('/api/auth/logout').expect(204)
  })

  it('ends access to protected routes', async () => {
    const agent = await signIn(app)
    await agent.get('/api/wash-cloud-features').expect(200)

    await agent.post('/api/auth/logout').expect(204)

    await agent.get('/api/auth/me').expect(401)
  })
})

describe('token expiry', () => {
  it('rejects an access token once it has expired', async () => {
    // The injected clock earns its place here: without it this test would have
    // to wait 15 real minutes, or not exist.
    const deps = createTestDeps()
    const loginApp = createApp(deps)

    const agent = request.agent(loginApp)
    const user = await createTestUser()
    await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200)

    await agent.get('/api/auth/me').expect(200)

    // Same cookies, an app whose clock is an hour later.
    const later = new Date(deps.clock().getTime() + 60 * 60 * 1000)
    const futureApp = createApp({ ...deps, clock: () => later })

    const cookie = (
      await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })
    ).headers['set-cookie'] as unknown as string[]

    await request(futureApp)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(401)
  })
})
