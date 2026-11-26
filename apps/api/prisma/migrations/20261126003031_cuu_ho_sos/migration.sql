-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('MOI', 'DANG_TIM_GARAGE', 'DA_NHAN', 'KHONG_CO_GARAGE', 'DANG_DEN', 'TAI_HIEN_TRUONG', 'XU_LY_TAI_CHO', 'DANG_KEO_XE', 'DA_VE_GARAGE', 'HOAN_THANH', 'KHACH_HUY');

-- CreateEnum
CREATE TYPE "SosIssueType" AS ENUM ('HET_BINH', 'THUNG_LOP', 'CHET_MAY', 'TAI_NAN', 'HET_NHIEN_LIEU', 'KEO_XE', 'KHAC');

-- CreateTable
CREATE TABLE "sos_configs" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "on_duty" BOOLEAN NOT NULL DEFAULT true,
    "hotline" TEXT,
    "radius_km" INTEGER NOT NULL DEFAULT 30,
    "base_price" BIGINT NOT NULL DEFAULT 0,
    "branch_id" UUID,
    "note" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "sos_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SosStatus" NOT NULL DEFAULT 'MOI',
    "user_id" UUID,
    "vehicle_id" UUID,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "plate_no" TEXT,
    "vehicle_info" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address_text" TEXT,
    "issue_type" "SosIssueType" NOT NULL,
    "description" TEXT,
    "customer_image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "scene_image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "candidate_tenant_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "assigned_tenant_id" UUID,
    "assigned_branch_id" UUID,
    "assigned_staff_id" UUID,
    "eta_minutes" INTEGER,
    "quoted_price" BIGINT,
    "final_price" BIGINT,
    "seller_note" TEXT,
    "cancel_reason" TEXT,
    "order_id" UUID,
    "access_hash" TEXT NOT NULL,
    "search_expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_tracks" (
    "id" BIGSERIAL NOT NULL,
    "sos_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sos_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "replied_by" UUID,
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sos_requests_code_key" ON "sos_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sos_requests_order_id_key" ON "sos_requests"("order_id");

-- CreateIndex
CREATE INDEX "sos_requests_status_search_expires_at_idx" ON "sos_requests"("status", "search_expires_at");

-- CreateIndex
CREATE INDEX "sos_requests_assigned_tenant_id_status_created_at_idx" ON "sos_requests"("assigned_tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sos_requests_user_id_created_at_idx" ON "sos_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sos_requests_phone_status_idx" ON "sos_requests"("phone", "status");

-- CreateIndex
CREATE INDEX "sos_requests_created_at_idx" ON "sos_requests"("created_at");

-- CreateIndex
CREATE INDEX "sos_tracks_sos_id_at_idx" ON "sos_tracks"("sos_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "sos_reviews_sos_id_key" ON "sos_reviews"("sos_id");

-- CreateIndex
CREATE INDEX "sos_reviews_tenant_id_created_at_idx" ON "sos_reviews"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "sos_tracks" ADD CONSTRAINT "sos_tracks_sos_id_fkey" FOREIGN KEY ("sos_id") REFERENCES "sos_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_reviews" ADD CONSTRAINT "sos_reviews_sos_id_fkey" FOREIGN KEY ("sos_id") REFERENCES "sos_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
