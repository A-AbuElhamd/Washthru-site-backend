/**
 * The contract a table registers against to get a full REST API.
 *
 * WHY THIS EXISTS (decision #8)
 * ----------------------------
 * There are 28 tables. Hand-writing list/create/update/delete/reorder for each
 * is roughly 135 endpoints — the tedium that made the 28-table design look
 * expensive in the first place. Instead every table declares itself here, and
 * ONE implementation serves all of them.
 *
 * The trade is deliberate and worth stating plainly: a bug in the generic layer
 * is a bug in all 28 tables at once. That is exactly why it is built first, and
 * tested hardest.
 */

import type Joi from 'joi'

/** A database row. The CRUD layer is intentionally shape-agnostic — Joi owns shape. */
export type Row = Record<string, unknown>

/**
 * The subset of a Prisma model delegate this layer uses.
 *
 * Prisma generates a precisely-typed delegate per model, but they are 28
 * different types and this layer treats them uniformly on purpose. Threading
 * full generics through would add a great deal of type machinery to describe
 * code whose whole point is not caring about the specific shape — and the shape
 * IS checked, by Joi, at the edge where untrusted data arrives.
 */
export interface CrudDelegate {
  findMany(args: Record<string, unknown>): Promise<Row[]>
  findFirst(args: Record<string, unknown>): Promise<Row | null>
  count(args?: Record<string, unknown>): Promise<number>
  create(args: Record<string, unknown>): Promise<Row>
  update(args: Record<string, unknown>): Promise<Row>
}

/**
 * Which of the cross-cutting schema rules a given table participates in.
 *
 * Not every table has every feature — `page_content` has no sort order,
 * `tags` has no soft delete — so the generic layer asks rather than assumes.
 */
export interface ResourceFeatures {
  /**
   * Table has `deleted_at`. Delete becomes a soft delete, and every read
   * filters deleted rows out (rule 4).
   */
  softDelete: boolean

  /**
   * Table has `sort_order`. Lists are ordered by it and the reorder endpoint is
   * available (rule 2).
   */
  sortOrder: boolean

  /**
   * Table has `status` + a draft/published distinction (rule 3). Public reads
   * can then ask for published rows only.
   */
  status: boolean

  /**
   * Table has a unique `slug`, so rows are addressable by it as well as by id
   * (rule 1).
   */
  slug: boolean
}

export interface ResourceConfig {
  /**
   * The Prisma model name — the property on the client, e.g. `washCloudFeature`
   * for `prisma.washCloudFeature`.
   */
  model: string

  /** URL segment this is mounted at, e.g. `wash-cloud-features`. */
  path: string

  /** Human name used in error messages, e.g. "Wash Cloud feature". */
  label: string

  /** Validates a create request. Unknown keys are stripped, not rejected. */
  createSchema: Joi.ObjectSchema

  /** Validates an update request — the same shape with everything optional. */
  updateSchema: Joi.ObjectSchema

  features: ResourceFeatures
}

/** Sensible defaults so a registration only states what differs. */
export const DEFAULT_FEATURES: ResourceFeatures = {
  softDelete: true,
  sortOrder: true,
  status: false,
  slug: false,
}

/**
 * Resolves the Prisma delegate for a resource.
 *
 * The cast is the one deliberate escape hatch in this layer — see `CrudDelegate`
 * above for why. It is contained to this single function rather than scattered
 * through the router, and it throws loudly on a typo in `model` instead of
 * failing later with "cannot read property findMany of undefined".
 */
export function getDelegate(prisma: unknown, model: string): CrudDelegate {
  const delegate = (prisma as Record<string, unknown>)[model]

  if (!delegate || typeof delegate !== 'object') {
    throw new Error(
      `Unknown Prisma model "${model}". Check the \`model\` in its resource registration.`,
    )
  }

  return delegate as CrudDelegate
}
