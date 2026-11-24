-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "CatalogProposalStatus" AS ENUM ('CHO_XU_LY', 'DA_TAO', 'TU_CHOI');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('NHAP', 'CHO_DUYET', 'DANG_BAN', 'BI_TU_CHOI', 'TAM_AN', 'BI_GO');

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" UUID NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "brand" TEXT,
    "unit" TEXT,
    "specs" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "image_file_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_proposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "note" TEXT,
    "status" "CatalogProposalStatus" NOT NULL DEFAULT 'CHO_XU_LY',
    "catalog_item_id" UUID,
    "review_note" TEXT,
    "created_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "catalog_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "province" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "opening_hours" JSONB NOT NULL DEFAULT '[]',
    "return_policy" TEXT,
    "warranty_policy" TEXT,
    "cancel_policy" TEXT,
    "logo_file_id" UUID,
    "cover_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "product_id" UUID,
    "manual_stock" INTEGER,
    "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "price" BIGINT NOT NULL,
    "list_price" BIGINT,
    "price_from" BOOLEAN NOT NULL DEFAULT false,
    "install_included" BOOLEAN NOT NULL DEFAULT false,
    "mfg_year" INTEGER,
    "duration_minutes" INTEGER,
    "note" TEXT,
    "image_file_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "OfferStatus" NOT NULL DEFAULT 'NHAP',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_categories_kind_parent_id_idx" ON "catalog_categories"("kind", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");

-- CreateIndex
CREATE INDEX "catalog_items_kind_category_id_idx" ON "catalog_items"("kind", "category_id");

-- CreateIndex
CREATE INDEX "catalog_proposals_status_created_at_idx" ON "catalog_proposals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shops_tenant_id_key" ON "shops"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE INDEX "offers_tenant_id_kind_status_idx" ON "offers"("tenant_id", "kind", "status");

-- CreateIndex
CREATE INDEX "offers_status_submitted_at_idx" ON "offers"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "offers_catalog_item_id_status_idx" ON "offers"("catalog_item_id", "status");

-- AddForeignKey
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
