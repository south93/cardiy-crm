-- CreateTable
CREATE TABLE "customer_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_invites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_links_customer_id_key" ON "customer_links"("customer_id");

-- CreateIndex
CREATE INDEX "customer_links_user_id_idx" ON "customer_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invites_token_hash_key" ON "customer_invites"("token_hash");

-- CreateIndex
CREATE INDEX "customer_invites_customer_id_idx" ON "customer_invites"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_sessions_token_hash_key" ON "owner_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "owner_sessions_user_id_idx" ON "owner_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "customer_links" ADD CONSTRAINT "customer_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_links" ADD CONSTRAINT "customer_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
