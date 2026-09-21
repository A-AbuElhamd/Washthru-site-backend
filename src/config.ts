/**
 * Application configuration, loaded from environment variables and validated
 * at startup.
 *
 * Why validate here rather than reading `process.env` where it's needed:
 * a missing or malformed variable should stop the server immediately, with a
 * message naming the variable. The alternative is `undefined` travelling
 * quietly through the app until it surfaces as something unhelpful at 3am.
 *
 * This is also the first use of Joi in the codebase, and it shows the pattern
 * used everywhere else: Joi validates at runtime, TypeScript describes the
 * shape, and `Joi.ObjectSchema<T>` ties the two together so the compiler
 * complains if they drift apart.
 */

import 'dotenv/config'
import Joi from 'joi'

/** The environments this service knows how to run in. */
export type NodeEnv = 'development' | 'test' | 'production'

/**
 * The validated configuration. Note these are the *parsed* types — `port` is a
 * number and `corsOrigins` an array, even though both arrive as strings.
 */
export interface Config {
  nodeEnv: NodeEnv
  port: number
  logLevel: string
  /** Origins permitted to call this API. Never a wildcard — see below. */
  corsOrigins: string[]
  /** Proxy hops to trust for X-Forwarded-For. 0 = no proxy. */
  trustProxyHops: number
  /** PostgreSQL connection string for this process. */
  databaseUrl: string
  /** Secret used to sign access tokens. */
  jwtSecret: string
  /** Access token lifetime in seconds. Short by design — see src/auth/tokens.ts. */
  accessTokenTtlSeconds: number
  /** Refresh token lifetime in seconds. */
  refreshTokenTtlSeconds: number
  /** Convenience flags, so call sites read as intent rather than comparison. */
  isProduction: boolean
  isTest: boolean
}

/**
 * The shape of the raw environment, before parsing. Kept separate from
 * `Config` because everything arrives from the OS as a string.
 */
interface RawEnv {
  NODE_ENV: NodeEnv
  PORT: number
  LOG_LEVEL: string
  CORS_ORIGINS: string
  TRUST_PROXY_HOPS: number
  DATABASE_URL: string
  JWT_SECRET: string
  ACCESS_TOKEN_TTL_SECONDS: number
  REFRESH_TOKEN_TTL_SECONDS: number
}

/** 15 minutes. Short on purpose — a JWT cannot be revoked once issued. */
const DEFAULT_ACCESS_TTL = 15 * 60

/** 30 days. The revocable half; deleting its row ends the session. */
const DEFAULT_REFRESH_TTL = 30 * 24 * 60 * 60

/**
 * Minimum signing-secret length.
 *
 * A short secret can be brute-forced offline by anyone holding one token, which
 * would let them mint tokens for any user. 32 characters is the floor; generate
 * with `openssl rand -base64 48`.
 */
const MIN_SECRET_LENGTH = 32

const envSchema: Joi.ObjectSchema<RawEnv> = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  PORT: Joi.number().port().default(3002),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'debug')
    .default('info'),

  // Comma-separated list. A wildcard is not offered because it cannot work:
  // the auth cookie makes every request credentialed, and browsers reject
  // `Access-Control-Allow-Origin: *` on credentialed requests. See decision #18.
  //
  // `.allow('')` is required: Joi rejects empty strings for `Joi.string()` by
  // default, so without it an explicitly empty `CORS_ORIGINS=` in a .env file
  // would crash the server at boot. Empty is legitimate — it means "no
  // cross-origin callers", which is correct for a same-origin deployment.
  CORS_ORIGINS: Joi.string()
    .allow('')
    .default('')
    // Required in production. Left empty there, the allowlist matches nothing,
    // every browser request from the dashboard is blocked, and the only symptom
    // is a CORS error in the browser console that says nothing about the cause.
    // Failing at boot with a clear message is far cheaper to diagnose.
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(1).required().messages({
        'any.required':
          'CORS_ORIGINS is required in production. Set it to the dashboard and site origins, comma-separated.',
        'string.empty':
          'CORS_ORIGINS cannot be empty in production — no browser request would be allowed through.',
      }),
    }),

  // Whether a reverse proxy sits in front of this process.
  //
  // ⚠️ Cuts both ways. Behind Azure App Service the real client IP arrives in
  // `X-Forwarded-For`, and WITHOUT trusting the proxy every request looks like
  // it came from the proxy — so the IP rate limiter would treat the whole
  // internet as one client. But trusting a proxy that is NOT there is worse: any
  // client can then forge `X-Forwarded-For` and claim any IP it likes, which
  // defeats the rate limiter entirely.
  //
  // So it is configuration, not a constant. Default off (safe when running
  // directly); set to 1 on Azure.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),

  // Required, with no default. A server that cannot reach its database is
  // useless, so it should refuse to start and say so rather than begin serving
  // requests that all fail.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required()
    .messages({
      'any.required':
        'DATABASE_URL is required. Copy .env.example to .env and set it.',
      // Joi reports a scheme mismatch as `string.uriCustomScheme`, NOT
      // `string.uri` — overriding only the latter leaves a MySQL URL producing
      // Joi's raw message about allowed schemes.
      'string.uriCustomScheme':
        'DATABASE_URL must be a postgresql:// connection string.',
      'string.uri':
        'DATABASE_URL must be a valid postgresql:// connection string.',
    }),

  JWT_SECRET: Joi.string()
    .min(MIN_SECRET_LENGTH)
    .required()
    .messages({
      'any.required':
        'JWT_SECRET is required. Generate one with: openssl rand -base64 48',
      'string.min': `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters. A short secret can be brute-forced offline by anyone holding a single token.`,
    }),

  ACCESS_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(60 * 60)
    .default(DEFAULT_ACCESS_TTL)
    .messages({
      'number.max':
        'Access tokens must be short-lived — they cannot be revoked once issued. One hour is the ceiling.',
    }),

  REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(60 * 60)
    .default(DEFAULT_REFRESH_TTL),
})
  // Ignore the many unrelated variables the OS provides.
  .unknown(true)

/**
 * Reads and validates the environment.
 *
 * Exported (rather than run at import time) so tests can build a config from a
 * synthetic environment without touching the real one.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { error, value } = envSchema.validate(env, {
    abortEarly: false, // report every problem at once, not just the first
    stripUnknown: false,
  })

  if (error) {
    const problems = error.details.map((d) => `  - ${d.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${problems}`)
  }

  const raw = value as RawEnv

  return Object.freeze({
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    corsOrigins: raw.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    trustProxyHops: raw.TRUST_PROXY_HOPS,
    databaseUrl: raw.DATABASE_URL,
    jwtSecret: raw.JWT_SECRET,
    accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: raw.REFRESH_TOKEN_TTL_SECONDS,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
  })
}

/**
 * The configuration for this process.
 *
 * Importing this module validates the environment as a side effect, which is
 * what makes a misconfigured server fail at boot rather than on first request.
 */
export const config: Config = loadConfig()
