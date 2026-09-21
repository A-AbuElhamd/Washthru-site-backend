/**
 * The generic CRUD layer (decision #8).
 *
 * This is the most important test file in the codebase. One implementation
 * serves all 28 tables, so a bug here is a bug in every one of them — and
 * conversely, these tests cover all 28 tables' list/create/update/delete
 * behaviour at once.
 *
 * Everything runs against a REAL PostgreSQL. Several assertions below could not
 * pass against a mock: the 409 on a duplicate slug comes from a real partial
 * unique index, and "a deleted slug can be reused" is precisely the behaviour
 * that index exists to provide.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type TestAgent from 'supertest/lib/agent.js'
import { createTestApp } from './factory.js'
import { clearAllTables, disconnectTestPrisma, getTestPrisma } from './helpers/database.js'
import { signIn } from './helpers/auth.js'

const prisma = getTestPrisma()
const app = createTestApp()

/**
 * A signed-in caller.
 *
 * Every CRUD route is protected (Session 4), so an unauthenticated request now
 * returns 401. `api` is a Supertest agent that carries the auth cookies, and it
 * is recreated in `beforeEach` because `clearAllTables` deletes the user along
 * with everything else.
 */
let api: TestAgent

/** A valid Wash Cloud feature body — the simplest registered resource. */
function feature(overrides: Record<string, unknown> = {}) {
  return {
    titleAr: 'ميزة',
    titleEn: 'Feature',
    descriptionAr: 'وصف',
    descriptionEn: 'Description',
    ...overrides,
  }
}

/** A valid product body — exercises slug, status and nested jsonb lists. */
function product(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'rf-v1',
    category: 'touchless',
    titleAr: 'منتج',
    titleEn: 'Product',
    subtitleAr: 'عنوان فرعي',
    subtitleEn: 'Subtitle',
    typeLabelAr: 'نوع',
    typeLabelEn: 'Type',
    descriptionAr: 'وصف المنتج',
    descriptionEn: 'Product description',
    ...overrides,
  }
}

beforeEach(async () => {
  await clearAllTables(prisma)
  api = await signIn(app)
})

afterAll(async () => {
  await disconnectTestPrisma()
})

describe('create', () => {
  it('creates a row and returns 201 with it', async () => {
    const res = await api.post('/api/wash-cloud-features').send(feature()).expect(201)

    expect(res.body.id).toBeTruthy()
    expect(res.body.titleEn).toBe('Feature')
    expect(res.body.createdAt).toBeTruthy()
  })

  it('reports every missing field at once, not just the first', async () => {
    // The dashboard highlights all invalid fields together, so returning them
    // one at a time would turn one bad save into several round trips.
    const res = await api.post('/api/wash-cloud-features').send({}).expect(400)

    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    const fields = res.body.error.fields.map((f: { field: string }) => f.field)
    expect(fields).toEqual(
      expect.arrayContaining(['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn']),
    )
  })

  it('rejects a half-translated row', async () => {
    // Bilingual content is the whole point of the sibling-column design; a row
    // with Arabic but no English would render blank on the English site.
    const res = await api
      .post('/api/wash-cloud-features')
      .send(feature({ titleEn: '' }))
      .expect(400)

    expect(res.body.error.fields[0].message).toMatch(/English/)
  })

  it('strips unknown keys rather than failing', async () => {
    // The registration defines exactly what may be written. Extra keys are
    // dropped, not passed to Prisma where they would throw something unhelpful.
    const res = await api
      .post('/api/wash-cloud-features')
      .send(feature({ notAColumn: 'nonsense', deletedAt: '2020-01-01' }))
      .expect(201)

    expect(res.body.notAColumn).toBeUndefined()
    expect(res.body.deletedAt).toBeNull()
  })

  it('appends new rows to the end rather than the top', async () => {
    await api.post('/api/wash-cloud-features').send(feature({ titleEn: 'A' })).expect(201)
    await api.post('/api/wash-cloud-features').send(feature({ titleEn: 'B' })).expect(201)

    const res = await api.get('/api/wash-cloud-features').expect(200)
    expect(res.body.data.map((r: { titleEn: string }) => r.titleEn)).toEqual(['A', 'B'])
  })

  it('rejects a duplicate slug with 409', async () => {
    // This 409 comes from a real partial unique index in Postgres — not from a
    // check in application code that could drift. It is also the fix for a live
    // bug: `id: payload.slug || crypto.randomUUID()` currently lets a duplicate
    // slug create a duplicate primary key.
    await api.post('/api/products').send(product()).expect(201)

    const res = await api.post('/api/products').send(product()).expect(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('rejects a malformed slug', async () => {
    const res = await api
      .post('/api/products')
      .send(product({ slug: 'Not A Slug!' }))
      .expect(400)

    expect(res.body.error.fields[0].field).toBe('slug')
  })

  it('rejects a category outside the enum', async () => {
    const res = await api
      .post('/api/products')
      .send(product({ category: 'hovercraft' }))
      .expect(400)

    expect(res.body.error.fields[0].field).toBe('category')
  })

  it('defaults nested lists to empty arrays', async () => {
    // Without a default these would be NULL in a NOT NULL jsonb column and fail
    // at the database rather than at validation.
    const res = await api.post('/api/products').send(product()).expect(201)

    expect(res.body.quickInfo).toEqual([])
    expect(res.body.videos).toEqual([])
  })

  it('defaults status to draft', async () => {
    const res = await api.post('/api/products').send(product()).expect(201)
    expect(res.body.status).toBe('draft')
  })
})

describe('list', () => {
  it('returns the standard pagination envelope', async () => {
    await api.post('/api/wash-cloud-features').send(feature()).expect(201)

    const res = await api.get('/api/wash-cloud-features').expect(200)

    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 })
    expect(res.body.data).toHaveLength(1)
  })

  it('reports zero pages for an empty table', async () => {
    // Not 1 — otherwise a pager renders "Page 1 of 1" over nothing.
    const res = await api.get('/api/wash-cloud-features').expect(200)
    expect(res.body).toMatchObject({ total: 0, totalPages: 0 })
  })

  it('paginates', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api
        .post('/api/wash-cloud-features')
        .send(feature({ titleEn: `F${i}` }))
        .expect(201)
    }

    const res = await api.get('/api/wash-cloud-features?page=2&limit=2').expect(200)

    expect(res.body.data.map((r: { titleEn: string }) => r.titleEn)).toEqual(['F2', 'F3'])
    expect(res.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 })
  })

  it('caps the page size', async () => {
    // `?limit=100000` on a growing table would otherwise be a free
    // denial-of-service: one request loading the whole table into memory.
    const res = await api.get('/api/wash-cloud-features?limit=100000').expect(400)
    expect(res.body.error.fields[0].field).toBe('limit')
  })

  it('rejects nonsense pagination rather than silently serving page 1', async () => {
    const res = await api.get('/api/wash-cloud-features?page=abc').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('filters to published rows when asked', async () => {
    await api.post('/api/products').send(product({ slug: 'draft-one' })).expect(201)
    await api
      .post('/api/products')
      .send(product({ slug: 'live-one', status: 'published' }))
      .expect(201)

    const all = await api.get('/api/products').expect(200)
    expect(all.body.total).toBe(2)

    // What the public site asks for.
    const live = await api.get('/api/products?status=published').expect(200)
    expect(live.body.total).toBe(1)
    expect(live.body.data[0].slug).toBe('live-one')
  })
})

describe('get one', () => {
  it('finds a row by id', async () => {
    const created = await api.post('/api/products').send(product()).expect(201)

    const res = await api.get(`/api/products/${created.body.id}`).expect(200)
    expect(res.body.slug).toBe('rf-v1')
  })

  it('finds a row by slug', async () => {
    // The dashboard uses ids; the public site uses readable slugs. One endpoint
    // serves both.
    await api.post('/api/products').send(product()).expect(201)

    const res = await api.get('/api/products/rf-v1').expect(200)
    expect(res.body.slug).toBe('rf-v1')
  })

  it('returns 404 for an unknown id', async () => {
    const res = await api
      .get('/api/products/11111111-1111-1111-1111-111111111111')
      .expect(404)

    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 rather than erroring when a slug is used on a table without slugs', async () => {
    // Comparing a uuid column to arbitrary text is a Postgres type error, so the
    // router must not attempt it.
    const res = await api.get('/api/wash-cloud-features/some-slug').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('update', () => {
  it('changes only the fields sent', async () => {
    const created = await api.post('/api/wash-cloud-features').send(feature()).expect(201)

    const res = await api
      .patch(`/api/wash-cloud-features/${created.body.id}`)
      .send({ titleEn: 'Renamed' })
      .expect(200)

    expect(res.body.titleEn).toBe('Renamed')
    // Untouched fields survive.
    expect(res.body.titleAr).toBe('ميزة')
    expect(res.body.descriptionEn).toBe('Description')
  })

  it('rejects an empty body', async () => {
    const created = await api.post('/api/wash-cloud-features').send(feature()).expect(201)

    const res = await api
      .patch(`/api/wash-cloud-features/${created.body.id}`)
      .send({})
      .expect(400)

    expect(res.body.error.fields[0].message).toMatch(/at least one field/)
  })

  it('returns 404 for an unknown row', async () => {
    await api
      .patch('/api/wash-cloud-features/11111111-1111-1111-1111-111111111111')
      .send({ titleEn: 'x' })
      .expect(404)
  })

  it('rejects an update that would duplicate a slug', async () => {
    await api.post('/api/products').send(product({ slug: 'first' })).expect(201)
    const second = await api
      .post('/api/products')
      .send(product({ slug: 'second' }))
      .expect(201)

    await api
      .patch(`/api/products/${second.body.id}`)
      .send({ slug: 'first' })
      .expect(409)
  })
})

describe('delete', () => {
  it('soft deletes rather than removing the row', async () => {
    const created = await api.post('/api/products').send(product()).expect(201)

    await api.delete(`/api/products/${created.body.id}`).expect(204)

    // Gone from the API...
    await api.get(`/api/products/${created.body.id}`).expect(404)

    // ...but still recoverable in the database.
    const row = await prisma.product.findUnique({ where: { id: created.body.id } })
    expect(row).not.toBeNull()
    expect(row?.deletedAt).not.toBeNull()
  })

  it('hides deleted rows from lists and counts', async () => {
    // Forgetting this filter on one endpoint is the classic way deleted content
    // reappears on a live site.
    const created = await api.post('/api/wash-cloud-features').send(feature()).expect(201)
    await api.delete(`/api/wash-cloud-features/${created.body.id}`).expect(204)

    const res = await api.get('/api/wash-cloud-features').expect(200)
    expect(res.body.total).toBe(0)
    expect(res.body.data).toHaveLength(0)
  })

  it('frees the slug for reuse', async () => {
    // THE test for the partial unique indexes. With a plain unique index this
    // fails with a 409 — a deleted product would hold its slug hostage forever.
    const created = await api.post('/api/products').send(product()).expect(201)
    await api.delete(`/api/products/${created.body.id}`).expect(204)

    await api.post('/api/products').send(product()).expect(201)
  })

  it('returns 404 when deleting something already deleted', async () => {
    const created = await api.post('/api/products').send(product()).expect(201)

    await api.delete(`/api/products/${created.body.id}`).expect(204)
    await api.delete(`/api/products/${created.body.id}`).expect(404)
  })
})

describe('reorder', () => {
  it('reorders the whole list in one transaction', async () => {
    const ids: string[] = []
    for (const name of ['A', 'B', 'C']) {
      const res = await api
        .post('/api/wash-cloud-features')
        .send(feature({ titleEn: name }))
        .expect(201)
      ids.push(res.body.id)
    }

    // Reverse it, the way a drag-and-drop UI would submit.
    await api
      .patch('/api/wash-cloud-features/reorder/all')
      .send({ ids: [...ids].reverse() })
      .expect(204)

    const res = await api.get('/api/wash-cloud-features').expect(200)
    expect(res.body.data.map((r: { titleEn: string }) => r.titleEn)).toEqual(['C', 'B', 'A'])
  })

  it('rejects a malformed body', async () => {
    await api
      .patch('/api/wash-cloud-features/reorder/all')
      .send({ ids: 'not-an-array' })
      .expect(400)
  })
})
