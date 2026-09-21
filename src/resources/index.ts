/**
 * Resource registry.
 *
 * Each table declares itself here and gets list / get / create / update /
 * delete / reorder from the generic layer. Adding a table is a registration,
 * not a new set of endpoints.
 *
 * Two are registered so far. The remaining tables follow the same pattern and
 * are added as the dashboard needs them.
 */

import Joi from 'joi'
import { DEFAULT_FEATURES, type ResourceConfig } from '../crud/types.js'

/* -------------------------------------------------------------------------- *
 * Shared field builders
 *
 * Bilingual content is sibling columns (decision #4), so almost every text
 * field comes in pairs. These keep the pairs consistent and the error messages
 * useful — the dashboard shows them directly to the person editing.
 * -------------------------------------------------------------------------- */

/** A required Arabic/English pair, e.g. `title` → `titleAr` + `titleEn`. */
function requiredPair(field: string, label: string, max = 400) {
  return {
    [`${field}Ar`]: Joi.string().trim().max(max).required().messages({
      'any.required': `${label} (Arabic) is required`,
      'string.empty': `${label} (Arabic) is required`,
    }),
    [`${field}En`]: Joi.string().trim().max(max).required().messages({
      'any.required': `${label} (English) is required`,
      'string.empty': `${label} (English) is required`,
    }),
  }
}

/** Long-form required pair, for body text with no sensible length cap. */
function requiredTextPair(field: string, label: string) {
  return {
    [`${field}Ar`]: Joi.string().trim().required().messages({
      'any.required': `${label} (Arabic) is required`,
      'string.empty': `${label} (Arabic) is required`,
    }),
    [`${field}En`]: Joi.string().trim().required().messages({
      'any.required': `${label} (English) is required`,
      'string.empty': `${label} (English) is required`,
    }),
  }
}

/**
 * A slug: lowercase, kebab-case, URL-safe.
 *
 * Constrained deliberately — slugs end up in URLs and in the content files, and
 * a slug with spaces or capitals causes problems that only surface much later.
 */
const slug = Joi.string()
  .trim()
  .lowercase()
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(200)
  .messages({
    'string.pattern.base':
      'Slug must be lowercase words separated by single hyphens, e.g. "rf-v1"',
  })

/** An optional reference to a media asset. */
const mediaId = Joi.string().uuid().allow(null)

/**
 * Turns a create schema into an update schema.
 *
 * Update is the same shape with everything optional — a PATCH changes only the
 * fields it sends. `min(1)` rejects an empty body, which is always a mistake
 * rather than a request to change nothing.
 */
function toUpdateSchema(createSchema: Joi.ObjectSchema): Joi.ObjectSchema {
  return createSchema.fork(Object.keys(createSchema.describe().keys), (field) =>
    field.optional(),
  ).min(1).messages({
    'object.min': 'Provide at least one field to update',
  })
}

/* -------------------------------------------------------------------------- *
 * Wash Cloud features
 *
 * The simplest table in the schema: two bilingual pairs and an order. A good
 * shape to read first when learning how a registration works.
 * -------------------------------------------------------------------------- */

const washCloudFeatureCreate = Joi.object({
  ...requiredPair('title', 'Title'),
  ...requiredTextPair('description', 'Description'),
  sortOrder: Joi.number().integer().min(0),
})

export const washCloudFeatures: ResourceConfig = {
  model: 'washCloudFeature',
  path: 'wash-cloud-features',
  label: 'Wash Cloud feature',
  createSchema: washCloudFeatureCreate,
  updateSchema: toUpdateSchema(washCloudFeatureCreate),
  features: { ...DEFAULT_FEATURES },
}

/* -------------------------------------------------------------------------- *
 * Products
 *
 * Exercises the harder paths: a unique slug, draft/published status, media
 * foreign keys, and nested lists kept in the row as jsonb (decision #7).
 * -------------------------------------------------------------------------- */

const productCreate = Joi.object({
  slug: slug.required().messages({ 'any.required': 'Slug is required' }),

  category: Joi.string().valid('touchless', 'rollover', 'tunnel').required().messages({
    'any.only': 'Category must be touchless, rollover or tunnel',
    'any.required': 'Category is required',
  }),

  ...requiredPair('title', 'Title'),
  ...requiredPair('subtitle', 'Subtitle'),
  ...requiredPair('typeLabel', 'Type label', 200),
  ...requiredTextPair('description', 'Description'),

  heroImageId: mediaId,
  pdfArId: mediaId,
  pdfEnId: mediaId,

  /// Nested lists. `default([])` matters: without it a product created without
  /// them would store NULL in a NOT NULL jsonb column and fail at the database.
  quickInfo: Joi.array()
    .items(
      Joi.object({
        labelAr: Joi.string().allow('').required(),
        labelEn: Joi.string().allow('').required(),
        valueAr: Joi.string().allow('').required(),
        valueEn: Joi.string().allow('').required(),
      }),
    )
    .default([]),

  videos: Joi.array()
    .items(
      Joi.object({
        titleAr: Joi.string().allow('').required(),
        titleEn: Joi.string().allow('').required(),
        youtubeId: Joi.string().required(),
      }),
    )
    .default([]),

  status: Joi.string().valid('draft', 'published').default('draft'),
  publishedAt: Joi.date().allow(null),
  sortOrder: Joi.number().integer().min(0),
})

export const products: ResourceConfig = {
  model: 'product',
  path: 'products',
  label: 'Product',
  createSchema: productCreate,
  updateSchema: toUpdateSchema(productCreate),
  features: { ...DEFAULT_FEATURES, status: true, slug: true },
}

/** Every registered resource, in mount order. */
export const resources: ResourceConfig[] = [washCloudFeatures, products]
