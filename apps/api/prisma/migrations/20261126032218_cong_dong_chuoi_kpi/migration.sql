-- CreateEnum
CREATE TYPE "CommunityPostType" AS ENUM ('BLOG', 'AUDIO', 'PLAYLIST', 'QA');

-- CreateEnum
CREATE TYPE "CommunityPostStatus" AS ENUM ('NHAP', 'CHO_DUYET', 'DA_DANG', 'BI_TU_CHOI', 'TAM_AN', 'BI_GO');

-- CreateEnum
CREATE TYPE "CommunityAuthorKind" AS ENUM ('PLATFORM', 'GARAGE', 'OWNER');

-- CreateEnum
CREATE TYPE "BannerPosition" AS ENUM ('HOME', 'COMMUNITY');

-- CreateTable
CREATE TABLE "community_posts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CommunityPostType" NOT NULL,
    "author_kind" "CommunityAuthorKind" NOT NULL,
    "author_user_id" UUID,
    "author_tenant_id" UUID,
    "author_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'KINH_NGHIEM',
    "cover_file_id" UUID,
    "media_url" TEXT,
    "duration_minutes" INTEGER,
    "playlist_items" JSONB NOT NULL DEFAULT '[]',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_solved" BOOLEAN NOT NULL DEFAULT false,
    "accepted_comment_id" UUID,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "comments_count" INTEGER NOT NULL DEFAULT 0,
    "status" "CommunityPostStatus" NOT NULL DEFAULT 'CHO_DUYET',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_kind" "CommunityAuthorKind" NOT NULL,
    "author_user_id" UUID,
    "author_tenant_id" UUID,
    "author_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hidden_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_likes" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_likes_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateTable
CREATE TABLE "platform_banners" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "link_url" TEXT,
    "cta_label" TEXT,
    "image_file_id" UUID,
    "position" "BannerPosition" NOT NULL DEFAULT 'COMMUNITY',
    "sort_order" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_posts_code_key" ON "community_posts"("code");

-- CreateIndex
CREATE INDEX "community_posts_status_pinned_published_at_idx" ON "community_posts"("status", "pinned", "published_at");

-- CreateIndex
CREATE INDEX "community_posts_status_type_published_at_idx" ON "community_posts"("status", "type", "published_at");

-- CreateIndex
CREATE INDEX "community_posts_author_user_id_created_at_idx" ON "community_posts"("author_user_id", "created_at");

-- CreateIndex
CREATE INDEX "community_posts_author_tenant_id_created_at_idx" ON "community_posts"("author_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "community_comments_post_id_hidden_created_at_idx" ON "community_comments"("post_id", "hidden", "created_at");

-- CreateIndex
CREATE INDEX "platform_banners_position_active_sort_order_idx" ON "platform_banners"("position", "active", "sort_order");

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
