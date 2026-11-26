-- CreateEnum
CREATE TYPE "ChatbotChannel" AS ENUM ('PUBLIC_WEB', 'OWNER_APP');

-- CreateEnum
CREATE TYPE "ChatbotProposalStatus" AS ENUM ('DE_XUAT', 'DA_XAC_NHAN', 'DA_HUY');

-- CreateTable
CREATE TABLE "chatbot_sessions" (
    "id" UUID NOT NULL,
    "channel" "ChatbotChannel" NOT NULL,
    "user_id" UUID,
    "session_hash" TEXT,
    "vehicle_id" UUID,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "odometer_km" INTEGER,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sanitized_context" TEXT,
    "pii_masked_count" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'heuristic',
    "cited_doc_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matched_offers" JSONB NOT NULL DEFAULT '[]',
    "maintenance_plan" JSONB,
    "proposal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatbot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_booking_proposals" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "channel" "ChatbotChannel" NOT NULL,
    "status" "ChatbotProposalStatus" NOT NULL DEFAULT 'DE_XUAT',
    "tenant_id" UUID NOT NULL,
    "shop_name" TEXT NOT NULL,
    "shop_slug" TEXT,
    "branch_id" UUID,
    "branch_name" TEXT,
    "vehicle_id" UUID,
    "vehicle_label" TEXT,
    "offer_id" UUID,
    "unit_price" BIGINT,
    "service_name" TEXT NOT NULL,
    "suggested_slots" JSONB NOT NULL DEFAULT '[]',
    "confirmed_slot" TIMESTAMP(3),
    "booking_id" UUID,
    "booking_code" TEXT,
    "order_request_id" UUID,
    "order_request_code" TEXT,
    "tracking_path" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatbot_booking_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_sessions_session_hash_key" ON "chatbot_sessions"("session_hash");

-- CreateIndex
CREATE INDEX "chatbot_sessions_user_id_channel_updated_at_idx" ON "chatbot_sessions"("user_id", "channel", "updated_at");

-- CreateIndex
CREATE INDEX "chatbot_messages_session_id_created_at_idx" ON "chatbot_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chatbot_booking_proposals_session_id_created_at_idx" ON "chatbot_booking_proposals"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chatbot_booking_proposals_tenant_id_status_created_at_idx" ON "chatbot_booking_proposals"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chatbot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_booking_proposals" ADD CONSTRAINT "chatbot_booking_proposals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chatbot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
