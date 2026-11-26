-- CreateEnum
CREATE TYPE "AiSuggestionKind" AS ENUM ('VEHICLE_SUMMARY', 'QUOTE_SUGGESTION', 'TECH_QA');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('DE_XUAT', 'DA_AP_DUNG', 'BO_QUA');

-- CreateTable
CREATE TABLE "ai_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'BAO_DUONG',
    "make" TEXT,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_text" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "kind" "AiSuggestionKind" NOT NULL,
    "vehicle_id" UUID,
    "order_id" UUID,
    "prompt_summary" TEXT NOT NULL,
    "sanitized_context" TEXT NOT NULL,
    "pii_masked_count" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'heuristic',
    "response_text" TEXT NOT NULL,
    "suggested_items" JSONB NOT NULL DEFAULT '[]',
    "cited_doc_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'DE_XUAT',
    "applied_item_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_documents_tenant_id_active_category_idx" ON "ai_documents"("tenant_id", "active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_documents_tenant_id_code_key" ON "ai_documents"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "ai_suggestions_tenant_id_kind_created_at_idx" ON "ai_suggestions"("tenant_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_order_id_created_at_idx" ON "ai_suggestions"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_vehicle_id_created_at_idx" ON "ai_suggestions"("vehicle_id", "created_at");
