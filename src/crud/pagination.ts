/**
 * Pagination (decision #18): page number + size.
 *
 * `?page=2&limit=20`, and the response carries `data`, `page`, `limit`, `total`
 * and `totalPages`. Familiar, easy to build a pager against, and adequate here —
 * most tables hold well under 100 rows, and the two that grow forever
 * (`contact_submissions`, `audit_log`) are only ever read by an admin.
 *
 * Cursor pagination was considered and rejected as premature.
 */

import Joi from 'joi'
import { validationFailed, type FieldError } from '../errors.js'

export const DEFAULT_LIMIT = 20

/**
 * Hard ceiling on page size.
 *
 * Without it, `?limit=100000` on `audit_log` is a free denial-of-service: one
 * request that loads the whole table into memory and serialises it to JSON.
 */
export const MAX_LIMIT = 100

export interface Pagination {
  page: number
  limit: number
  /** Rows to skip — what Prisma's `skip` wants. */
  skip: number
}

export interface Paginated<T> {
  data: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
}).unknown(true) // other query params (filters) are handled elsewhere

/**
 * Reads and validates pagination from a query string.
 *
 * Invalid values are rejected rather than silently clamped: `?page=abc` is a
 * bug in the caller, and quietly serving page 1 hides it.
 */
export function parsePagination(query: unknown): Pagination {
  const { error, value } = querySchema.validate(query ?? {}, {
    abortEarly: false,
    convert: true,
  })

  if (error) {
    const fields: FieldError[] = error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
    }))
    throw validationFailed(fields, 'Invalid pagination parameters')
  }

  const { page, limit } = value as { page: number; limit: number }

  return { page, limit, skip: (page - 1) * limit }
}

/** Wraps rows in the standard envelope. */
export function paginate<T>(data: T[], total: number, pagination: Pagination): Paginated<T> {
  return {
    data,
    page: pagination.page,
    limit: pagination.limit,
    total,
    // An empty table is 0 pages, not 1 — otherwise a pager renders "Page 1 of 1"
    // over nothing.
    totalPages: Math.ceil(total / pagination.limit),
  }
}
