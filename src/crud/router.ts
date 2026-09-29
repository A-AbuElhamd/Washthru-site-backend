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
  type AppError,
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
function validate<T>(
  schema: Joi.ObjectSchema,
  payload: unknown,
  options: { applyDefaults: boolean },
): T {
  const { error, value } = schema.validate(payload ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,

    // ⚠️ THE MOST IMPORTANT LINE IN THIS FILE, for updates.
    //
    // Joi's `.optional()` does NOT remove a `.default()`. The update schema is
    // built by forking the create schema to all-optional, so without this the
    // defaults still fire on a PATCH:
    //
    //   PATCH /api/products/rf-v1 {"titleEn":"RF V1"}
    //     validated => { titleEn, quickInfo: [], videos: [], status: 'draft' }
    //
    // An editor fixing a typo would silently wipe the product's spec table and
    // video list AND un-publish it from the live site — returning 200. It also
    // defeated `.min(1)`, since the validated object was never empty, so an
    // empty PATCH body performed that same destructive write.
    //
    // Creates DO want defaults (a new product genuinely needs `quickInfo: []`,
    // because the column is NOT NULL).
    noDefaults: !options.applyDefaults,
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

function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = (error as { code: unknown }).code
  return typeof code === 'string' ? code : null
}

/**
 * Turns a Prisma error into the right HTTP response.
 *
 * Every one of these is a CLIENT mistake. Left unmapped they escape as 500s,
 * which tells the caller the service is broken, sends them looking in the wrong
 * place, and pages whoever is on call for a bad request body.
 *
 * Returns `null` when the error is genuinely ours, so it can propagate to the
 * error handler and be logged with its stack.
 */
function mapPrismaError(error: unknown, label: string): AppError | null {
  switch (prismaErrorCode(error)) {
    // Unique constraint — a duplicate slug. Comes from a real partial unique
    // index in Postgres, not an application check that could drift.
    case PRISMA_UNIQUE_VIOLATION:
      return conflict(`A ${label.toLowerCase()} with those details already exists`)

    // Value too long for the column. Reachable whenever a Joi `max()` is looser
    // than the column width.
    case 'P2000':
      return validationFailed(
        [{ field: 'body', message: 'One of the values is too long for its field' }],
        'A value exceeds the maximum length',
      )

    // Foreign key violation — e.g. `heroImageId` pointing at a media asset that
    // does not exist, or deleting a file another row still references.
    case 'P2003':
      return conflict(
        'That references something which does not exist, or is still in use elsewhere',
      )

    // Record not found for an update/delete.
    case 'P2025':
      return notFound(`${label} not found`)

    default:
      return null
  }
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

/**
 * Orders by `sort_order` when the table has one, else newest first.
 *
 * ⚠️ The `id` tiebreaker is not decoration. `sort_order` values can tie (two
 * rows created concurrently, or after a delete shifts the count), and
 * `created_at` ties easily in seed data at millisecond precision. With no
 * tiebreaker, Postgres returns tied rows in whatever order it likes — and that
 * order can differ between two identical requests, so with 20-row pages a row
 * can appear on two pages or on neither.
 */
function defaultOrderBy(config: ResourceConfig): Record<string, unknown>[] {
  return config.features.sortOrder
    ? [{ sortOrder: 'asc' }, { id: 'asc' }]
    : [{ createdAt: 'desc' }, { id: 'asc' }]
}

/**
 * The next `sort_order` value — one past the current highest.
 *
 * NOT `count()`. Count shrinks when a row is soft-deleted while the remaining
 * rows keep their original values, so: create A(0) B(1) C(2), delete B, create D
 * → count is 2 → D collides with C. Ties then order unpredictably (see above).
 */
async function nextSortOrder(delegate: CrudDelegate, config: ResourceConfig): Promise<number> {
  const last = await delegate.findFirst({
    where: activeWhere(config),
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const highest = last?.['sortOrder']
  return typeof highest === 'number' ? highest + 1 : 0
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

/**
 * The signed-in user's id, for the `created_by` / `updated_by` columns.
 *
 * Populated by `requireAuth`, which runs in front of every CRUD route. It is
 * still optional here because `Request.user` is optional on the type — most
 * routes in an Express app never set it.
 */
function actorId(req: Request): string | undefined {
  return req.user?.id
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

    // `?status=` filters on tables that have one. Omitted, everything is
    // returned — drafts included — which is what the dashboard wants.
    //
    // ⚠️ The public site MUST pass `?status=published`. Omitting it there would
    // publish unfinished drafts. Once a public read path exists, consider making
    // that the default for unauthenticated callers rather than relying on every
    // caller to remember.
    if (config.features.status) {
      const status = req.query['status']

      if (status !== undefined) {
        // An unrecognised value used to be ignored silently, so `?status=pubished`
        // (typo) returned drafts while appearing to filter. Rejecting it means the
        // caller finds out.
        if (status !== 'draft' && status !== 'published') {
          throw validationFailed([
            { field: 'status', message: 'status must be "draft" or "published"' },
          ])
        }
        where['status'] = status
      }
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
    const data = validate<Row>(config.createSchema, req.body, { applyDefaults: true })

    if (config.features.sortOrder && data['sortOrder'] === undefined) {
      // Append to the end rather than defaulting to 0, where every new row would
      // land at the top in reverse order of creation.
      data['sortOrder'] = await nextSortOrder(delegate, config)
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
      const mapped = mapPrismaError(error, config.label)
      if (mapped) throw mapped
      throw error
    }
  })

  /** UPDATE — partial; only the supplied fields change. */
  router.patch('/:identifier', async (req, res) => {
    const identifier = req.params['identifier'] ?? ''
    const existing = await findOne(delegate, config, identifier)

    if (!existing) throw notFound(`${config.label} not found`)

    const data = validate<Row>(config.updateSchema, req.body, { applyDefaults: false })

    const actor = actorId(req)
    if (actor) data['updatedBy'] = actor

    try {
      const updated = await delegate.update({
        where: { id: existing['id'] as string },
        data,
      })
      res.json(updated)
    } catch (error) {
      const mapped = mapPrismaError(error, config.label)
      if (mapped) throw mapped
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

      // Reject repeats before touching the database. Left alone, the last
      // occurrence silently wins and the caller gets a 204 for an order that was
      // never applied as sent.
      if (new Set(ids).size !== ids.length) {
        throw validationFailed([{ field: 'ids', message: 'ids must not contain duplicates' }])
      }

      // Check the FORMAT before querying. Postgres raises a type error when a
      // uuid column is compared to text that is not a UUID, which would surface
      // as a 500 rather than a 400 naming the bad value.
      const malformed = ids.filter((id) => !UUID_PATTERN.test(id))
      if (malformed.length > 0) {
        throw validationFailed(
          malformed.map((id) => ({ field: 'ids', message: `"${id}" is not a valid id` })),
        )
      }

      // Verify every id exists and is not deleted, BEFORE the transaction.
      //
      // Without this, an unknown id — or a malformed one that is not even a UUID
      // — reaches Prisma and throws, which the error handler reports as a 500.
      // A caller sending bad input should get a 4xx naming the problem, not a
      // server error suggesting the service is broken.
      const existing = await delegate.findMany({
        where: { ...activeWhere(config), id: { in: ids } },
        select: { id: true },
      })

      if (existing.length !== ids.length) {
        const found = new Set(existing.map((row) => row['id'] as string))
        const missing = ids.filter((id) => !found.has(id))
        throw validationFailed(
          missing.map((id) => ({ field: 'ids', message: `No ${config.label.toLowerCase()} with id "${id}"` })),
          'Some ids do not exist',
        )
      }

      const actor = actorId(req)

      await (deps.prisma as unknown as {
        $transaction(operations: unknown[]): Promise<unknown>
      }).$transaction(
        ids.map((id, index) =>
          delegate.update({
            where: { id },
            data: { sortOrder: index, ...(actor ? { updatedBy: actor } : {}) },
          }),
        ),
      )

      res.status(204).send()
    })
  }

  return router
}
