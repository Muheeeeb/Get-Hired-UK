-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('blog', 'story', 'insight');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('draft', 'published');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'social';

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "type" "PostType" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "cover_image_key" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'draft',
    "author_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_type_status_published_at_idx" ON "posts"("type", "status", "published_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
