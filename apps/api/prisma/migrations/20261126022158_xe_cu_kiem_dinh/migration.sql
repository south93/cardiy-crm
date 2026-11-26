-- CreateEnum
CREATE TYPE "UsedCarSellerType" AS ENUM ('OWNER', 'GARAGE');

-- CreateEnum
CREATE TYPE "UsedCarListingStatus" AS ENUM ('NHAP', 'CHO_DUYET', 'DANG_BAN', 'BI_TU_CHOI', 'TAM_AN', 'DA_BAN', 'HET_HAN', 'BI_GO');

-- CreateEnum
CREATE TYPE "UsedCarAppraisalStatus" AS ENUM ('CHO_XAC_NHAN', 'DA_HEN', 'DANG_KIEM_DINH', 'HOAN_THANH', 'TU_CHOI', 'HUY');

-- CreateEnum
CREATE TYPE "AppraisalGrade" AS ENUM ('DAT_CHUAN', 'LUU_Y', 'KHONG_DAT');

-- CreateTable
CREATE TABLE "appraisal_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fee" BIGINT NOT NULL DEFAULT 500000,
    "branch_id" UUID,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisal_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_car_listings" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "seller_type" "UsedCarSellerType" NOT NULL,
    "seller_user_id" UUID,
    "seller_tenant_id" UUID,
    "branch_id" UUID,
    "vehicle_id" UUID,
    "title" TEXT NOT NULL,
    "plate_no" TEXT,
    "vin" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "mileage_km" INTEGER NOT NULL,
    "body_style" TEXT NOT NULL DEFAULT 'SEDAN',
    "transmission" TEXT NOT NULL DEFAULT 'TU_DONG',
    "fuel" TEXT NOT NULL DEFAULT 'XANG',
    "exterior_color" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 5,
    "owners_count" INTEGER NOT NULL DEFAULT 1,
    "price" BIGINT NOT NULL,
    "negotiable" BOOLEAN NOT NULL DEFAULT true,
    "province" TEXT NOT NULL,
    "address_text" TEXT,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "description" TEXT,
    "image_file_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "doc_file_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "verified_appraisal_id" UUID,
    "has_verified_badge" BOOLEAN NOT NULL DEFAULT false,
    "status" "UsedCarListingStatus" NOT NULL DEFAULT 'NHAP',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "sold_at" TIMESTAMP(3),
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "used_car_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_car_appraisals" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "requested_by_user_id" UUID,
    "assigned_member_id" UUID,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "quoted_fee" BIGINT NOT NULL,
    "final_fee" BIGINT,
    "payment_method" "PaymentMethod",
    "cash_entry_id" UUID,
    "status" "UsedCarAppraisalStatus" NOT NULL DEFAULT 'CHO_XAC_NHAN',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "no_major_accident" BOOLEAN NOT NULL DEFAULT true,
    "no_flood_damage" BOOLEAN NOT NULL DEFAULT true,
    "valid_documents" BOOLEAN NOT NULL DEFAULT true,
    "inspected_mileage_km" INTEGER,
    "score" INTEGER,
    "grade" "AppraisalGrade",
    "summary" TEXT,
    "report_image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "customer_note" TEXT,
    "reject_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "used_car_appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_car_saves" (
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_car_saves_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateTable
CREATE TABLE "used_car_threads" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_user_id" UUID,
    "buyer_name" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "viewing_at" TIMESTAMP(3),
    "viewing_status" TEXT NOT NULL DEFAULT 'NONE',
    "access_hash" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_car_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_car_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_role" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_car_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appraisal_configs_tenant_id_key" ON "appraisal_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "used_car_listings_code_key" ON "used_car_listings"("code");

-- CreateIndex
CREATE INDEX "used_car_listings_status_has_verified_badge_published_at_idx" ON "used_car_listings"("status", "has_verified_badge", "published_at");

-- CreateIndex
CREATE INDEX "used_car_listings_status_province_idx" ON "used_car_listings"("status", "province");

-- CreateIndex
CREATE INDEX "used_car_listings_seller_user_id_created_at_idx" ON "used_car_listings"("seller_user_id", "created_at");

-- CreateIndex
CREATE INDEX "used_car_listings_seller_tenant_id_status_idx" ON "used_car_listings"("seller_tenant_id", "status");

-- CreateIndex
CREATE INDEX "used_car_listings_status_submitted_at_idx" ON "used_car_listings"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "used_car_appraisals_cash_entry_id_key" ON "used_car_appraisals"("cash_entry_id");

-- CreateIndex
CREATE INDEX "used_car_appraisals_listing_id_created_at_idx" ON "used_car_appraisals"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "used_car_appraisals_tenant_id_status_scheduled_at_idx" ON "used_car_appraisals"("tenant_id", "status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "used_car_appraisals_tenant_id_code_key" ON "used_car_appraisals"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "used_car_saves_listing_id_idx" ON "used_car_saves"("listing_id");

-- CreateIndex
CREATE INDEX "used_car_threads_listing_id_last_message_at_idx" ON "used_car_threads"("listing_id", "last_message_at");

-- CreateIndex
CREATE INDEX "used_car_threads_buyer_user_id_last_message_at_idx" ON "used_car_threads"("buyer_user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "used_car_messages_thread_id_created_at_idx" ON "used_car_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "used_car_appraisals" ADD CONSTRAINT "used_car_appraisals_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "used_car_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "used_car_saves" ADD CONSTRAINT "used_car_saves_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "used_car_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "used_car_threads" ADD CONSTRAINT "used_car_threads_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "used_car_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "used_car_messages" ADD CONSTRAINT "used_car_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "used_car_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
