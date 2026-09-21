-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cms";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ops";

-- CreateEnum
CREATE TYPE "auth"."user_role" AS ENUM ('admin', 'editor');

-- CreateEnum
CREATE TYPE "cms"."media_kind" AS ENUM ('image', 'pdf');

-- CreateEnum
CREATE TYPE "cms"."content_status" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "cms"."locale" AS ENUM ('ar', 'en');

-- CreateEnum
CREATE TYPE "ops"."audit_action" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "ops"."contact_request_type" AS ENUM ('inquiry', 'complaint', 'consultation', 'purchase', 'maintenance');

-- CreateEnum
CREATE TYPE "cms"."product_category" AS ENUM ('touchless', 'rollover', 'tunnel');

-- CreateEnum
CREATE TYPE "cms"."news_category" AS ENUM ('product-launches', 'partnerships-contracts', 'exhibitions-events', 'achievements-expansions', 'in-media');

-- CreateEnum
CREATE TYPE "cms"."blueprint_plan_type" AS ENUM ('station', 'service-center');

-- CreateEnum
CREATE TYPE "cms"."blueprint_street_config" AS ENUM ('one-street', 'two-streets-before', 'two-streets-after', 'two-streets-behind', 'three-streets-before', 'three-streets-after', 'three-streets-behind', 'four-streets');

-- CreateEnum
CREATE TYPE "cms"."service_icon" AS ENUM ('ClipboardList', 'Ruler', 'HardHat', 'GraduationCap', 'Calculator', 'Headphones', 'Wrench', 'RefreshCcw');

-- CreateEnum
CREATE TYPE "cms"."value_icon" AS ENUM ('Award', 'Lightbulb', 'HeartHandshake');

-- CreateTable
CREATE TABLE "auth"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "role" "auth"."user_role" NOT NULL DEFAULT 'editor',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."contact_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_type" "ops"."contact_request_type" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "has_car_wash" BOOLEAN NOT NULL,
    "message" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "table_name" VARCHAR(120) NOT NULL,
    "record_id" UUID NOT NULL,
    "action" "ops"."audit_action" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blob_path" VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(400) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "kind" "cms"."media_kind" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB,
    "checksum" VARCHAR(128),
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."page_content" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page" VARCHAR(80) NOT NULL,
    "block" VARCHAR(80) NOT NULL,
    "content" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."home_features" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "icon_id" UUID,
    "background_image_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "home_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."home_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "icon" "cms"."service_icon" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "home_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."home_testimonials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "quote_ar" TEXT NOT NULL,
    "quote_en" TEXT NOT NULL,
    "icon_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "home_testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."home_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "image_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "home_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."company_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "icon" "cms"."value_icon" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."company_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "year" VARCHAR(40) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."company_goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "photo_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" "cms"."product_category" NOT NULL,
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "type_label_ar" VARCHAR(200) NOT NULL,
    "type_label_en" VARCHAR(200) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "expanded_title_ar" VARCHAR(300) NOT NULL,
    "expanded_title_en" VARCHAR(300) NOT NULL,
    "expanded_description_ar" TEXT NOT NULL,
    "expanded_description_en" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(200) NOT NULL,
    "category" "cms"."product_category" NOT NULL,
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "subtitle_ar" VARCHAR(400) NOT NULL,
    "subtitle_en" VARCHAR(400) NOT NULL,
    "type_label_ar" VARCHAR(200) NOT NULL,
    "type_label_en" VARCHAR(200) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "hero_image_id" UUID,
    "pdf_ar_id" UUID,
    "pdf_en_id" UUID,
    "quick_info" JSONB NOT NULL,
    "videos" JSONB NOT NULL,
    "status" "cms"."content_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."product_testimonials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "quote_ar" TEXT NOT NULL,
    "quote_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."product_carousel_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_carousel_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."service_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "icon_id" UUID,
    "background_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."wash_cloud_features" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "wash_cloud_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."knowledge_resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "cover_text_ar" VARCHAR(300) NOT NULL,
    "cover_text_en" VARCHAR(300) NOT NULL,
    "pdf_ar_id" UUID,
    "pdf_en_id" UUID,
    "highlight_words" INTEGER NOT NULL DEFAULT 0,
    "status" "cms"."content_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."blueprint_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(200) NOT NULL,
    "locale" "cms"."locale" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "intro" TEXT NOT NULL,
    "plan_number" VARCHAR(80) NOT NULL,
    "measurement_label" VARCHAR(200) NOT NULL,
    "area_label" VARCHAR(200) NOT NULL,
    "idea_label" VARCHAR(200) NOT NULL,
    "plan_type" "cms"."blueprint_plan_type" NOT NULL,
    "street_config" "cms"."blueprint_street_config" NOT NULL,
    "sketchfab_embed_url" VARCHAR(1000),
    "image_id" UUID,
    "drawing_image_id" UUID,
    "footer_cover_image_id" UUID,
    "pdf_id" UUID,
    "features" JSONB NOT NULL,
    "status" "cms"."content_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "blueprint_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."warranty_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_ar" TEXT NOT NULL,
    "lead_en" TEXT NOT NULL,
    "rest_ar" TEXT NOT NULL,
    "rest_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "warranty_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."plan_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_line1_ar" VARCHAR(200) NOT NULL,
    "name_line1_en" VARCHAR(200) NOT NULL,
    "name_line2_ar" VARCHAR(200) NOT NULL,
    "name_line2_en" VARCHAR(200) NOT NULL,
    "tagline_ar" VARCHAR(400),
    "tagline_en" VARCHAR(400),
    "price_monthly_ar" VARCHAR(120),
    "price_monthly_en" VARCHAR(120),
    "price_annual_ar" VARCHAR(120),
    "price_annual_en" VARCHAR(120),
    "price_annual_strike_ar" VARCHAR(120),
    "price_annual_strike_en" VARCHAR(120),
    "bonus_monthly_ar" TEXT,
    "bonus_monthly_en" TEXT,
    "bonus_annual_ar" TEXT,
    "bonus_annual_en" TEXT,
    "features" JSONB NOT NULL,
    "discounts" JSONB NOT NULL,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "plan_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."blog_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(250) NOT NULL,
    "title_ar" VARCHAR(400) NOT NULL,
    "title_en" VARCHAR(400) NOT NULL,
    "description_ar" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "cover_image_id" UUID,
    "cover_image_alt_ar" VARCHAR(500),
    "cover_image_alt_en" VARCHAR(500),
    "author_name_ar" VARCHAR(200),
    "author_name_en" VARCHAR(200),
    "published_at" DATE NOT NULL,
    "content_updated_at" DATE,
    "reading_minutes_ar" INTEGER,
    "reading_minutes_en" INTEGER,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "content_html_ar" TEXT,
    "content_html_en" TEXT,
    "status" "cms"."content_status" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."news_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(250) NOT NULL,
    "title_ar" VARCHAR(400) NOT NULL,
    "title_en" VARCHAR(400) NOT NULL,
    "excerpt_ar" TEXT NOT NULL,
    "excerpt_en" TEXT NOT NULL,
    "category" "cms"."news_category" NOT NULL,
    "cover_image_id" UUID,
    "cover_image_alt_ar" VARCHAR(500),
    "cover_image_alt_en" VARCHAR(500),
    "published_at" DATE NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "content_html_ar" TEXT,
    "content_html_en" TEXT,
    "status" "cms"."content_status" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(120) NOT NULL,
    "label_ar" VARCHAR(200),
    "label_en" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms"."blog_post_tags" (
    "blog_post_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "blog_post_tags_pkey" PRIMARY KEY ("blog_post_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_active_key" ON "auth"."users"("email") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "auth"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "auth"."refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "contact_submissions_submitted_at_idx" ON "ops"."contact_submissions"("submitted_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_table_name_record_id_idx" ON "ops"."audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "ops"."audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "ops"."audit_log"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_blob_path_key" ON "cms"."media_assets"("blob_path");

-- CreateIndex
CREATE INDEX "media_assets_uploaded_by_idx" ON "cms"."media_assets"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "page_content_page_block_key" ON "cms"."page_content"("page", "block");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_category_key" ON "cms"."product_categories"("category");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "cms"."products"("status", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_active_key" ON "cms"."products"("slug") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "product_testimonials_product_id_idx" ON "cms"."product_testimonials"("product_id");

-- CreateIndex
CREATE INDEX "product_carousel_images_product_id_idx" ON "cms"."product_carousel_images"("product_id");

-- CreateIndex
CREATE INDEX "product_carousel_images_media_asset_id_idx" ON "cms"."product_carousel_images"("media_asset_id");

-- CreateIndex
CREATE INDEX "blueprint_plans_status_published_at_idx" ON "cms"."blueprint_plans"("status", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "blueprint_plans_slug_locale_active_key" ON "cms"."blueprint_plans"("slug", "locale") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "blog_posts_status_published_at_idx" ON "cms"."blog_posts"("status", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_active_key" ON "cms"."blog_posts"("slug") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "news_articles_status_published_at_idx" ON "cms"."news_articles"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "news_articles_category_idx" ON "cms"."news_articles"("category");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_slug_active_key" ON "cms"."news_articles"("slug") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "cms"."tags"("slug");

-- CreateIndex
CREATE INDEX "blog_post_tags_tag_id_idx" ON "cms"."blog_post_tags"("tag_id");

-- AddForeignKey
ALTER TABLE "auth"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."media_assets" ADD CONSTRAINT "media_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."home_features" ADD CONSTRAINT "home_features_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."home_features" ADD CONSTRAINT "home_features_background_image_id_fkey" FOREIGN KEY ("background_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."home_testimonials" ADD CONSTRAINT "home_testimonials_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."home_partners" ADD CONSTRAINT "home_partners_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."team_members" ADD CONSTRAINT "team_members_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."products" ADD CONSTRAINT "products_hero_image_id_fkey" FOREIGN KEY ("hero_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."products" ADD CONSTRAINT "products_pdf_ar_id_fkey" FOREIGN KEY ("pdf_ar_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."products" ADD CONSTRAINT "products_pdf_en_id_fkey" FOREIGN KEY ("pdf_en_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."product_testimonials" ADD CONSTRAINT "product_testimonials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "cms"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."product_carousel_images" ADD CONSTRAINT "product_carousel_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "cms"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."product_carousel_images" ADD CONSTRAINT "product_carousel_images_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."service_items" ADD CONSTRAINT "service_items_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."service_items" ADD CONSTRAINT "service_items_background_id_fkey" FOREIGN KEY ("background_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."knowledge_resources" ADD CONSTRAINT "knowledge_resources_pdf_ar_id_fkey" FOREIGN KEY ("pdf_ar_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."knowledge_resources" ADD CONSTRAINT "knowledge_resources_pdf_en_id_fkey" FOREIGN KEY ("pdf_en_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blueprint_plans" ADD CONSTRAINT "blueprint_plans_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blueprint_plans" ADD CONSTRAINT "blueprint_plans_drawing_image_id_fkey" FOREIGN KEY ("drawing_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blueprint_plans" ADD CONSTRAINT "blueprint_plans_footer_cover_image_id_fkey" FOREIGN KEY ("footer_cover_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blueprint_plans" ADD CONSTRAINT "blueprint_plans_pdf_id_fkey" FOREIGN KEY ("pdf_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blog_posts" ADD CONSTRAINT "blog_posts_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."news_articles" ADD CONSTRAINT "news_articles_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "cms"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blog_post_tags" ADD CONSTRAINT "blog_post_tags_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "cms"."blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms"."blog_post_tags" ADD CONSTRAINT "blog_post_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "cms"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
