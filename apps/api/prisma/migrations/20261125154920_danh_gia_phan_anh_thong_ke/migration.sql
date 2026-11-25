-- CreateEnum
CREATE TYPE "MarketReviewStatus" AS ENUM ('HIEN', 'AN');

-- CreateEnum
CREATE TYPE "MarketReportReason" AS ENUM ('SAI_GIA', 'HANG_KHONG_DUNG', 'THAI_DO_PHUC_VU', 'KHONG_LIEN_LAC_DUOC', 'BAO_HANH_DOI_TRA', 'THONG_TIN_SAI', 'KHAC');

-- CreateEnum
CREATE TYPE "MarketReportStatus" AS ENUM ('MOI', 'CHO_GIAI_TRINH', 'DA_GIAI_TRINH', 'DA_XU_LY', 'TU_CHOI');

-- CreateEnum
CREATE TYPE "ViolationAction" AS ENUM ('NHAC_NHO', 'GO_TIN', 'TAM_KHOA', 'CHAM_DUT');

-- CreateTable
CREATE TABLE "market_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "replied_by" UUID,
    "replied_at" TIMESTAMP(3),
    "status" "MarketReviewStatus" NOT NULL DEFAULT 'HIEN',
    "reported_reason" TEXT,
    "reported_by" UUID,
    "reported_at" TIMESTAMP(3),
    "moderated_by" UUID,
    "moderated_at" TIMESTAMP(3),
    "moderation_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_reports" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID,
    "offer_id" UUID,
    "reporter_name" TEXT NOT NULL,
    "reporter_phone" TEXT NOT NULL,
    "reason" "MarketReportReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "MarketReportStatus" NOT NULL DEFAULT 'MOI',
    "admin_note" TEXT,
    "seller_explanation" TEXT,
    "explained_by" UUID,
    "explained_at" TIMESTAMP(3),
    "resolution" TEXT,
    "handled_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_violations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID,
    "offer_id" UUID,
    "action" "ViolationAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_daily_views" (
    "tenant_id" UUID NOT NULL,
    "view_date" DATE NOT NULL,
    "target_key" TEXT NOT NULL,
    "offer_id" UUID,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shop_daily_views_pkey" PRIMARY KEY ("tenant_id","view_date","target_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_reviews_request_id_key" ON "market_reviews"("request_id");

-- CreateIndex
CREATE INDEX "market_reviews_tenant_id_status_created_at_idx" ON "market_reviews"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "market_reviews_reported_at_idx" ON "market_reviews"("reported_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_reports_code_key" ON "market_reports"("code");

-- CreateIndex
CREATE INDEX "market_reports_status_created_at_idx" ON "market_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "market_reports_tenant_id_status_created_at_idx" ON "market_reports"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "market_reports_request_id_idx" ON "market_reports"("request_id");

-- CreateIndex
CREATE INDEX "market_reports_reporter_phone_status_idx" ON "market_reports"("reporter_phone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shop_violations_code_key" ON "shop_violations"("code");

-- CreateIndex
CREATE INDEX "shop_violations_tenant_id_created_at_idx" ON "shop_violations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "shop_violations_created_at_idx" ON "shop_violations"("created_at");

-- CreateIndex
CREATE INDEX "shop_daily_views_tenant_id_view_date_idx" ON "shop_daily_views"("tenant_id", "view_date");

-- AddForeignKey
ALTER TABLE "market_reviews" ADD CONSTRAINT "market_reviews_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_reports" ADD CONSTRAINT "market_reports_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "order_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_violations" ADD CONSTRAINT "shop_violations_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "market_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
