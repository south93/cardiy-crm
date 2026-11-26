-- CreateEnum
CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'ADJUST');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('APP_PUSH', 'ZALO_ZNS', 'SMS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('NHAP', 'DA_LEN_LICH', 'HOAN_THANH', 'HUY');

-- CreateEnum
CREATE TYPE "CampaignDeliveryStatus" AS ENUM ('SENT', 'SKIPPED_NO_CONSENT', 'FAILED');

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ALL',
    "purpose" TEXT NOT NULL DEFAULT 'MARKETING',
    "granted" BOOLEAN NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_configs" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "vnd_per_point" INTEGER NOT NULL DEFAULT 100000,
    "point_value_vnd" INTEGER NOT NULL DEFAULT 1000,
    "silver_points" INTEGER NOT NULL DEFAULT 50,
    "gold_points" INTEGER NOT NULL DEFAULT 200,
    "diamond_points" INTEGER NOT NULL DEFAULT 500,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "type" "LoyaltyTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_segments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL DEFAULT 'APP_PUSH',
    "segment_id" UUID,
    "template_code" TEXT,
    "voucher_id" UUID,
    "title" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'NHAP',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "total_matched" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_no_consent" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_deliveries" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID,
    "user_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "CampaignDeliveryStatus" NOT NULL,
    "rendered_body" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID,
    "campaign_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'CAMPAIGN',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consents_user_id_created_at_idx" ON "consents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_tenant_id_customer_id_created_at_idx" ON "loyalty_transactions"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_tenant_id_order_id_type_key" ON "loyalty_transactions"("tenant_id", "order_id", "type");

-- CreateIndex
CREATE INDEX "customer_segments_tenant_id_deleted_at_idx" ON "customer_segments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segments_tenant_id_code_key" ON "customer_segments"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "marketing_campaigns_tenant_id_status_created_at_idx" ON "marketing_campaigns"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_campaigns_tenant_id_code_key" ON "marketing_campaigns"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "campaign_deliveries_campaign_id_status_idx" ON "campaign_deliveries"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_deliveries_customer_id_idx" ON "campaign_deliveries"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_key" ON "notification_templates"("code");

-- CreateIndex
CREATE INDEX "owner_notifications_user_id_read_at_created_at_idx" ON "owner_notifications"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "customer_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
