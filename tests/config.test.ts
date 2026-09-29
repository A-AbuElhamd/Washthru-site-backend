/**
 * Config validation.
 *
 * The value of `src/config.ts` is that a misconfigured server refuses to start
 * and says why. These tests pin that behaviour — without them it is easy to
 * "simplify" the validation later and reintroduce silent `undefined`s.
 */

import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

/**
 * The minimum environment a valid config needs.
 *
 * Only `DATABASE_URL` is genuinely required; everything else has a default.
 * Spread this into each case so a test is explicit about the one thing it is
 * actually exercising.
 */
const BASE = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5001/washthru_dev',
  JWT_SECRET: 'a-long-enough-test-secret-value-0000000000',
}

describe('loadConfig', () => {
  it('applies sensible defaults when optional values are absent', () => {
    const config = loadConfig({ ...BASE })

    expect(config.nodeEnv).toBe('development')
    expect(config.port).toBe(3002)
    expect(config.isProduction).toBe(false)
  })

  it('parses PORT into a number', () => {
    // Everything arrives from the OS as a string; handlers should not each
    // have to remember to call Number().
    const config = loadConfig({ ...BASE, PORT: '8080' })

    expect(config.port).toBe(8080)
    expect(typeof config.port).toBe('number')
  })

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const config = loadConfig({
      ...BASE,
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001 ,',
    })

    expect(config.corsOrigins).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ])
  })

  it('yields an empty origin list rather than [""] when unset', () => {
    // `''.split(',')` returns `['']`, which would allowlist an empty origin.
    const config = loadConfig({ ...BASE, CORS_ORIGINS: '' })

    expect(config.corsOrigins).toEqual([])
  })

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/,
    )
  })

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...BASE, PORT: '99999' })).toThrow(
      /Invalid environment configuration/,
    )
  })

  it('reports every problem at once, not just the first', () => {
    // `abortEarly: false`. With two bad values, fixing them one restart at a
    // time is miserable; the error should name both.
    let message = ''
    try {
      loadConfig({ ...BASE, NODE_ENV: 'staging', LOG_LEVEL: 'verbose' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/NODE_ENV/)
    expect(message).toMatch(/LOG_LEVEL/)
  })

  it('sets isProduction only in production', () => {
    // Production additionally requires CORS_ORIGINS — see the block below.
    expect(
      loadConfig({ ...BASE, NODE_ENV: 'production', CORS_ORIGINS: 'https://x.test' })
        .isProduction,
    ).toBe(true)
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).isProduction).toBe(false)
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).isTest).toBe(true)
  })

  it('ignores unrelated environment variables', () => {
    // The OS supplies dozens; an unknown one must not fail the boot.
    expect(() =>
      loadConfig({ ...BASE, PATH: '/usr/bin', HOME: '/root' }),
    ).not.toThrow()
  })
})

describe('loadConfig — production guardrails', () => {
  it('requires CORS_ORIGINS in production', () => {
    // Empty in production means the allowlist matches nothing and every browser
    // request from the dashboard is blocked — with no symptom except a CORS
    // error in the console that says nothing about the cause. Failing at boot
    // with a clear message is far cheaper to diagnose.
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /CORS_ORIGINS is required in production/,
    )
  })

  it('does not require CORS_ORIGINS outside production', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'development' })).not.toThrow()
  })

  it('does not trust any proxy by default', () => {
    // Trusting a proxy that is not there lets any client forge X-Forwarded-For
    // and claim any IP, which would defeat the rate limiter entirely. Azure sets
    // TRUST_PROXY_HOPS=1 explicitly.
    expect(loadConfig({ ...BASE }).trustProxyHops).toBe(0)
    expect(loadConfig({ ...BASE, TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1)
  })

  it('caps access token lifetime', () => {
    // They cannot be revoked once issued, so a long-lived one widens the window
    // in which a logged-out user still has access.
    expect(() =>
      loadConfig({ ...BASE, ACCESS_TOKEN_TTL_SECONDS: '86400' }),
    ).toThrow(/short-lived/)
  })

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...BASE, JWT_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    )
  })
})

describe('loadConfig — DATABASE_URL', () => {
  it('refuses to start without one, with an actionable message', () => {
    // A server that cannot reach its database should fail at boot rather than
    // begin serving requests that all fail. The message names the fix.
    let message = ''
    try {
      loadConfig({})
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/DATABASE_URL is required/)
    expect(message).toMatch(/\.env/)
  })

  it('rejects a connection string that is not postgresql', () => {
    // Catches a MySQL or SQLite URL pasted in by mistake, at boot rather than on
    // the first query.
    expect(() =>
      loadConfig({ ...BASE, DATABASE_URL: 'mysql://user:pw@localhost:3306/db' }),
    ).toThrow(/postgresql:\/\/ connection string/)
  })

  it('accepts both postgres:// and postgresql:// schemes', () => {
    // Both are valid and both appear in the wild.
    expect(
      loadConfig({ ...BASE, DATABASE_URL: 'postgres://user:pw@localhost:5001/db' }).databaseUrl,
    ).toContain('postgres://')
    expect(
      loadConfig({ ...BASE, DATABASE_URL: 'postgresql://user:pw@localhost:5001/db' }).databaseUrl,
    ).toContain('postgresql://')
  })
})
