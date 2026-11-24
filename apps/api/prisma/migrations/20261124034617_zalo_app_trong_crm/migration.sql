-- AlterTable
ALTER TABLE "zalo_tokens" ADD COLUMN     "app_id" TEXT,
ADD COLUMN     "app_secret_enc" TEXT,
ALTER COLUMN "refresh_token_enc" DROP NOT NULL;
