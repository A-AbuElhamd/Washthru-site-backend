/**
 * The generic CRUD router (decision #8).
 *
 * One implementation of list / get / create / update / delete / reorder that
 * every table registers against. This is the file that makes 28 tables
 * affordable — and the file where a bug is a bug in all 28 at once.
 *
 * WHAT IT HANDLES UNIFORMLY
 *  - soft delete, and filtering deleted rows out of every read (rule 4)
 *  - `sort_order` ordering and reordering (rule 2)
 *  - draft/published filtering (rule 3)
 *  - addressing rows by id or slug (rule 1)
 *  - pagination and the error envelope (decision #18)
 *  - Joi validation, with unknown keys stripped
 *
 * Express 5 note: handlers below simply `throw`. Express 5 forwards rejected
 * promises to the error handler automatically, so none of the `asyncHandler`
 * wrapping that Express 4 tutorials show is needed (decision #9).
 */

import { Router, type Request } from 'express'
import type Joi from 'joi'
import type { Deps } from '../deps.js'
import {
  conflict,
  notFound,
  validationFailed,
  type FieldError,
} from '../errors.js'
import { paginate, parsePagination } from './pagination.js'
import { getDelegate, type CrudDelegate, type ResourceConfig, type Row } from './types.js'

/** Prisma's error code for a unique constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002'

/** A UUID looks like this; anything else in the :id slot is treated as a slug. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runs a Joi schema and converts failures into the standard envelope.
 *
 * `stripUnknown` means a table's registration defines exactly what may be
 * written to it — extra keys in a request body are dropped rather than passed
 * to Prisma, where they would throw an unhelpful error.
 *
 * `abortEarly: false` reports every bad field at once. The dashboard shows all
 * invalid fields together, so returning them one at a time would turn a single
 * bad save into three round trips.
 */
function validate<T>(schema: Joi.ObjectSchema, payload: unknown): T {
  const { error, value } = schema.validate(payload ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  })

  if (error) {
    const fields: FieldError[] = error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
    }))
    throw validationFailed(fields)
  }

  return value as T
}

/** True when a thrown value is Prisma's unique-constraint error. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === PRISMA_UNIQUE_VIOLATION
  )
}

/**
 * The WHERE clause shared by every read.
 *
 * Soft-deleted rows are invisible everywhere — forgetting this filter on one
 * endpoint is the classic way deleted content reappears on a live site.
 */
function activeWhere(config: ResourceConfig): Record<string, unknown> {
  return config.features.softDelete ? { deletedAt: null } : {}
}

/** Orders by `sort_order` when the table has one, else newest first. */
function defaultOrderBy(config: ResourceConfig): Record<string, unknown> {
  return config.features.sortOrder ? { sortOrder: 'asc' } : { createdAt: 'desc' }
}

/**
 * Finds one row by id or slug.
 *
 * Accepting both means the dashboard can use ids while the public site uses
 * readable slugs, without two sets of endpoints.
 */
async function findOne(
  delegate: CrudDelegate,
  config: ResourceConfig,
  identifier: string,
): Promise<Row | null> {
  const isUuid = UUID_PATTERN.test(identifier)

  // A non-UUID identifier on a table without slugs can never match, and asking
  // Postgres to compare a uuid column to arbitrary text is a type error.
  if (!isUuid && !config.features.slug) return null

  return delegate.findFirst({
    where: {
      ...activeWhere(config),
      ...(isUuid ? { id: identifier } : { slug: identifier }),
    },
  })
}

/** Reads the actor's id from the request, once auth exists (Session 4). */
function actorId(_req: Request): string | undefined {
  return undefined
}

export function createCrudRouter(config: ResourceConfig, deps: Deps): Router {
  const router = Router({ mergeParams: true })
  const delegate = getDelegate(deps.prisma, config.model)

  /**
   * LIST — paginated, ordered, excluding deleted rows.
   *
   * `?status=published` narrows to published rows on tables that have a status;
   * the public site uses it, the dashboard does not.
   */
  router.get('/', async (req, res) => {
    const pagination = parsePagination(req.query)

    const where: Record<string, unknown> = { ...activeWhere(config) }

    if (config.features.status && req.query['status'] === 'published') {
      where['status'] = 'published'
    }

    // Count and page in parallel — they are independent queries.
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: defaultOrderBy(config),
        skip: pagination.skip,
        take: pagination.limit,
      }),
      delegate.count({ where }),
    ])

    res.json(paginate(rows, total, pagination))
  })

  /** GET ONE — by id or slug. */
  router.get('/:identifier', async (req, res) => {
    const identifier = req.params['identifier'] ?? ''
    const row = await findOne(delegate, config, identifier)

    if (!row) throw notFound(`${config.label} not found`)

    res.json(row)
  })

  /** CREATE. */
  router.post('/', async (req, res) => {
    const data = validate<Row>(config.createSchema, req.body)

    if (config.features.sortOrder && data['sortOrder'] === undefined) {
      // Append to the end rather than defaulting to 0, where every new row would
      // land at the top in reverse order of creation.
      const count = await delegate.count({ where: activeWhere(config) })
      data['sortOrder'] = count
    }

    const actor = actorId(req)
    if (actor) {
      data['createdBy'] = actor
      data['updatedBy'] = actor
    }

    try {
      const created = await delegate.create({ data })
      res.status(201).json(created)
    } catch (error) {
      // A duplicate slug is a client mistake, not a server fault — and this 409
      // comes from a real partial unique index in Postgres, not from a check in
      // application code that could drift out of sync.
      if (isUniqueViolation(error)) {
        throw conflict(`A ${config.label.toLowerCase()} with those details already exists`)
      }
      throw error
    }
  })

  /** UPDATE — partial; only the supplied fields change. */
  router.patch('/:identifier', async (req, res) => {
    const identifier = req.params['identifier'] ?? ''
    const existing = await findOne(delegate, config, identifier)

    if (!existing) throw notFound(`${config.label} not found`)

    const data = validate<Row>(config.updateSchema, req.body)

    const actor = actorId(req)
    if (actor) data['updatedBy'] = actor

    try {
      const updated = await delegate.update({
        where: { id: existing['id'] as string },
        data,
      })
      res.json(updated)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(`A ${config.label.toLowerCase()} with those details already exists`)
      }
      throw error
    }
  })

  /**
   * DELETE — soft where supported.
   *
   * The row stays in the table with `deleted_at` set, which is what makes the
   * partial unique indexes matter: the slug is released for reuse while the
   * record itself is still recoverable.
   */
  router.delete('/:identifier', async (req, res) => {
    const identifier = req.params['identifier'] ?? ''
    const existing = await findOne(delegate, config, identifier)

    if (!existing) throw notFound(`${config.label} not found`)

    if (config.features.softDelete) {
      await delegate.update({
        where: { id: existing['id'] as string },
        data: { deletedAt: deps.clock() },
      })
    } else {
      // Tables without `deleted_at` (join tables, for instance) delete for real.
      await (delegate as unknown as {
        delete(args: Record<string, unknown>): Promise<Row>
      }).delete({ where: { id: existing['id'] as string } })
    }

    res.status(204).send()
  })

  /**
   * REORDER — accepts the full ordered list of ids.
   *
   * One transaction, so a failure halfway cannot leave the list half-reordered.
   * Whole-list rather than "move item X to position N" because that is what a
   * drag-and-drop UI naturally produces, and it cannot drift out of sync.
   */
  if (config.features.sortOrder) {
    router.patch('/reorder/all', async (req, res) => {
      const body = req.body as { ids?: unknown }

      if (!Array.isArray(body?.ids) || body.ids.some((id) => typeof id !== 'string')) {
        throw validationFailed([
          { field: 'ids', message: 'ids must be an array of record ids in the desired order' },
        ])
      }

      const ids = body.ids as string[]

      await (deps.prisma as unknown as {
        $transaction(operations: unknown[]): Promise<unknown>
      }).$transaction(
        ids.map((id, index) =>
          delegate.update({ where: { id }, data: { sortOrder: index } }),
        ),
      )

      res.status(204).send()
    })
  }

  return router
}
