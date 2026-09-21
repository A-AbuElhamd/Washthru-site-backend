/**
 * Auth helpers for tests.
 *
 * Every protected endpoint needs a signed-in caller, so most integration tests
 * start by creating a user and logging in. These keep that to one line.
 *
 * The login goes through the REAL endpoint rather than minting a token
 * directly — so the tests exercise password verification, token issuing and
 * cookie handling on the way to whatever they are actually testing.
 */

import type { Express } from 'express'
import request from 'supertest'
import type TestAgent from 'supertest/lib/agent.js'
import { hashPassword } from '../../src/auth/password.js'
import { getTestPrisma } from './database.js'

export const TEST_PASSWORD = 'correct-horse-battery-staple'

export interface TestUserInput {
  email?: string
  name?: string
  role?: 'admin' | 'editor'
  password?: string
}

/** Creates a user with a known password. */
export async function createTestUser(input: TestUserInput = {}) {
  const prisma = getTestPrisma()

  return prisma.user.create({
    data: {
      email: input.email ?? 'ahmed@washthru.test',
      name: input.name ?? 'Ahmed',
      role: input.role ?? 'admin',
      passwordHash: await hashPassword(input.password ?? TEST_PASSWORD),
    },
  })
}

/**
 * Creates a user, logs in, and returns a Supertest agent carrying the cookies.
 *
 * `request.agent()` persists cookies between requests the way a browser does,
 * which is exactly what httpOnly cookie auth needs — there is no token for the
 * test to hold and attach by hand.
 */
export async function signIn(app: Express, input: TestUserInput = {}): Promise<TestAgent> {
  const user = await createTestUser(input)
  const agent = request.agent(app)

  await agent
    .post('/api/auth/login')
    .send({ email: user.email, password: input.password ?? TEST_PASSWORD })
    .expect(200)

  return agent
}
