/**
 * Application logger (Winston).
 *
 * Five rules from decision #15, four of which most Winston tutorials get wrong:
 *
 *  1. Console transport ONLY — never `transports.File`. On Azure App Service the
 *     filesystem is ephemeral: a restart wipes the file, and two instances give
 *     two disconnected partial logs. Azure collects stdout into Monitor /
 *     Application Insights on its own.
 *  2. JSON in production, pretty in development. Structured lines are what make
 *     logs queryable ("every 500 on /api/products"); pretty text is not.
 *  3. Never log request bodies. `ops.contact_submissions` holds customer names,
 *     phones and emails — real personal data under PDPL. A generic body-logging
 *     middleware copies every lead into a second system with different retention
 *     and different access rules.
 *  4. Never log the JWT. A token in a log file is a working dashboard key sitting
 *     in readable storage.
 *  5. Request-id child loggers, so one failure reads as one filterable trace
 *     instead of scattered lines.
 *
 * Rules 3 and 4 are primarily enforced by not passing those things to the
 * logger in the first place. `redactSensitive` below is a second line of
 * defence for when someone forgets.
 */

import winston from 'winston'
import { config } from './config.js'

/**
 * Keys whose values are never safe to write to a log, matched case-insensitively
 * against the whole key name.
 *
 * This is a backstop, not the primary control. The primary control is not
 * handing secrets to the logger at all.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'tokenhash',
  'token_hash',
  'authorization',
  'cookie',
  'secret',
  'jwt',
  // Lead data (PDPL) — these should never reach the logger, but if a whole
  // submission is passed by mistake, redact rather than publish it.
  'phone',
  'email',
]

const REDACTED = '[redacted]'

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase()
  return SENSITIVE_KEYS.some((sensitive) => normalised.includes(sensitive))
}

/**
 * Recursively replaces sensitive values with `[redacted]`.
 *
 * `seen` guards against circular references — an Express request object, for
 * example, refers back to itself, and without this the logger would hang.
 */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested, seen)
  }
  return result
}

/**
 * Winston format that strips sensitive values from every log entry's metadata.
 *
 * ⚠️ This MUTATES `info` in place and returns the same object. Do not be tempted
 * to rebuild it with `{ ...info }` — Winston's `info` carries Symbol properties
 * (`Symbol.for('level')`, `Symbol.for('message')`) that the pipeline uses to
 * route entries to transports. A spread copies only string keys, silently drops
 * those symbols, and every log entry is then discarded with no error at all.
 *
 * That failure mode is invisible: logging simply stops working. It was caught
 * here only because the redaction tests asserted an entry had actually arrived.
 */
const redactSensitive = winston.format((info) => {
  for (const key of Object.keys(info)) {
    // `level` and `message` are structural — leave them alone so a message that
    // happens to contain the word "token" is not mangled.
    if (key === 'level' || key === 'message') continue

    const record = info as unknown as Record<string, unknown>
    record[key] = isSensitiveKey(key)
      ? REDACTED
      : redactValue(record[key], new WeakSet())
  }
  return info
})

/**
 * Development formatting: human-readable, one line per entry.
 * Production formatting: JSON, so Azure can index and query the fields.
 */
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, requestId, ...rest }) => {
    const trace = requestId ? ` [${String(requestId).slice(0, 8)}]` : ''
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
    return `${String(timestamp)} ${level}${trace} ${String(message)}${extra}`
  }),
)

const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
)

export type Logger = winston.Logger

/** Builds a logger. Exported so tests can construct a silent one. */
export function createLogger(options: { level: string; silent?: boolean; pretty: boolean }): Logger {
  return winston.createLogger({
    level: options.level,
    silent: options.silent ?? false,
    format: winston.format.combine(
      redactSensitive(),
      options.pretty ? developmentFormat : productionFormat,
    ),
    // Rule 1: Console only. Azure reads stdout.
    transports: [new winston.transports.Console()],
  })
}

/** The logger for this process. */
export const logger: Logger = createLogger({
  level: config.logLevel,
  pretty: !config.isProduction,
  // Tests construct their own silent logger via `createTestApp`; this guard
  // keeps stray output quiet if the real logger is ever imported during a run.
  silent: config.isTest,
})
