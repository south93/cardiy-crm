-- CreateEnum
CREATE TYPE "CareKind" AS ENUM ('DANG_KIEM', 'BAO_HIEM', 'BAO_DUONG', 'HOI_THAM', 'KHAC');

-- CreateEnum
CREATE TYPE "CareStatus" AS ENUM ('CAN_GOI', 'GOI_LAI', 'XONG', 'BO_QUA');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('DA_TU_VAN', 'DAT_LICH', 'KHONG_NGHE', 'GOI_LAI_SAU', 'KHONG_CAN', 'SAI_SO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "care_settings" JSONB;

-- CreateTable
CREATE TABLE "care_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "order_id" UUID,
    "kind" "CareKind" NOT NULL,
    "ref_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "event_date" DATE,
    "status" "CareStatus" NOT NULL DEFAULT 'CAN_GOI',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_outcome" "CallOutcome",
    "done_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "note" TEXT,
    "next_at" DATE,
    "booking_id" UUID,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_tasks_tenant_id_status_due_date_idx" ON "care_tasks"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "care_tasks_customer_id_idx" ON "care_tasks"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "care_tasks_tenant_id_ref_key_key" ON "care_tasks"("tenant_id", "ref_key");

-- CreateIndex
CREATE INDEX "call_logs_task_id_created_at_idx" ON "call_logs"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "care_tasks" ADD CONSTRAINT "care_tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "care_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
