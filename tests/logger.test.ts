/**
 * Logger redaction.
 *
 * Decision #15 rules 3 and 4 say never log request bodies or the JWT. Those are
 * enforced primarily by not passing such things to the logger — but people
 * forget, and the cost of forgetting is customer phone numbers or a working
 * dashboard token sitting in Azure's log store.
 *
 * These tests pin the backstop.
 *
 * ⚠️ Winston writes ASYNCHRONOUSLY. Asserting immediately after `logger.info()`
 * reads an empty array, which makes a "does not contain the secret" assertion
 * pass for entirely the wrong reason. Every test here therefore awaits
 * `flush()` first, and asserts the entry actually arrived before inspecting it.
 */

import { describe, it, expect } from 'vitest'
import winston from 'winston'
import Transport from 'winston-transport'
import { createLogger } from '../src/logger.js'

interface Capture {
  logger: winston.Logger
  entries: Record<string, unknown>[]
  /** Waits until `count` entries have been recorded, or the timeout elapses. */
  flush: (count?: number) => Promise<void>
}

/**
 * An in-memory transport that records every entry it is given.
 *
 * NOTE: the obvious approach — `winston.transports.Stream` pointed at a
 * `Writable` — does not work here. It requires a genuine stream (a duck-typed
 * `{ write }` is rejected with "options.stream is required"), and even with a
 * real `Writable` nothing arrives, so assertions run against an empty array.
 * That is a dangerous failure mode: a "does not contain the password" assertion
 * passes trivially when nothing was captured.
 *
 * Subclassing `Transport` is Winston's documented extension point and hands us
 * the entry directly, AFTER the formats (including redaction) have run — which
 * is exactly what these tests need to inspect.
 */
class MemoryTransport extends Transport {
  readonly entries: Record<string, unknown>[] = []

  override log(info: Record<string, unknown>, next: () => void): void {
    this.entries.push(info)
    next()
  }
}

/** Captures what the logger writes, with the Console transport removed. */
function captureLogs(options: { silent?: boolean } = {}): Capture {
  const memory = new MemoryTransport()

  const logger = createLogger({
    level: 'debug',
    pretty: false,
    ...(options.silent === undefined ? {} : { silent: options.silent }),
  })
  logger.clear() // drop the Console transport
  logger.add(memory)

  async function flush(count = 1, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (memory.entries.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  return { logger, entries: memory.entries, flush }
}

/** Waits a few event-loop turns — used to prove nothing WAS written. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('logger redaction', () => {
  it('redacts a password', async () => {
    const { logger, entries, flush } = captureLogs()

    logger.info('login attempt', { email: 'a@b.com', password: 'hunter2' })
    await flush()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.password).toBe('[redacted]')
    expect(JSON.stringify(entries)).not.toContain('hunter2')
  })

  it('redacts tokens in any casing or naming style', async () => {
    const { logger, entries, flush } = captureLogs()

    logger.info('token issued', {
      accessToken: 'eyJhbGciOiJI.secret.value',
      refresh_token: 'refresh-secret',
      tokenHash: 'hash-secret',
    })
    await flush()

    expect(entries).toHaveLength(1)
    const serialised = JSON.stringify(entries)
    expect(serialised).not.toContain('eyJhbGciOiJI')
    expect(serialised).not.toContain('refresh-secret')
    expect(serialised).not.toContain('hash-secret')
  })

  it('redacts lead data nested inside an object', async () => {
    // The realistic mistake: logging a whole contact submission.
    const { logger, entries, flush } = captureLogs()

    logger.info('submission received', {
      submission: { name: 'Ahmed', phone: '+966500000000', email: 'a@b.com' },
    })
    await flush()

    expect(entries).toHaveLength(1)
    const serialised = JSON.stringify(entries)
    expect(serialised).not.toContain('+966500000000')
    expect(serialised).not.toContain('a@b.com')
    // The non-sensitive sibling survives, proving redaction is targeted rather
    // than the whole object being dropped.
    expect(serialised).toContain('Ahmed')
  })

  it('leaves harmless fields alone', async () => {
    const { logger, entries, flush } = captureLogs()

    logger.info('request completed', { method: 'GET', status: 200, durationMs: 12 })
    await flush()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.method).toBe('GET')
    expect(entries[0]?.status).toBe(200)
    expect(entries[0]?.durationMs).toBe(12)
  })

  it('does not mangle the message itself', async () => {
    // A message mentioning "token" is fine; only field VALUES are redacted.
    const { logger, entries, flush } = captureLogs()

    logger.info('refresh token rotated')
    await flush()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('refresh token rotated')
  })

  it('survives a circular reference without hanging', async () => {
    // Express request objects are circular. Without the guard in redactValue
    // this would recurse forever and lock up the process.
    const { logger, entries, flush } = captureLogs()

    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    expect(() => logger.info('circular', { circular })).not.toThrow()
    await flush()

    expect(entries).toHaveLength(1)
    expect(JSON.stringify(entries)).toContain('[circular]')
  })

  it('is silent when asked to be', async () => {
    // `silent: true` is what the test factory uses so runs stay quiet.
    const { logger, entries } = captureLogs({ silent: true })

    logger.info('should not appear')
    await settle()

    expect(entries).toHaveLength(0)
  })

  it('carries the requestId on a child logger', async () => {
    // Decision #15 rule 5 — one failure should read as one filterable trace.
    const { logger, entries, flush } = captureLogs()

    logger.child({ requestId: 'abc-123' }).info('something happened')
    await flush()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.requestId).toBe('abc-123')
  })
})
