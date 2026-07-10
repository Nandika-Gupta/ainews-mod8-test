-- CreateTable
CREATE TABLE "Publisher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "colorHex" TEXT,
    "followersLabel" TEXT,
    "credibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publisher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dek" TEXT NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "articleUrl" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "filterTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsBookmark" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsVote" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsComment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT 'Anonymous',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_NewsToTopic" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NewsToTopic_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Publisher_domain_key" ON "Publisher"("domain");

-- CreateIndex
CREATE INDEX "Publisher_name_idx" ON "Publisher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "News_slug_key" ON "News"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "News_articleUrl_key" ON "News"("articleUrl");

-- CreateIndex
CREATE INDEX "News_publishedAt_idx" ON "News"("publishedAt");

-- CreateIndex
CREATE INDEX "News_publisherId_idx" ON "News"("publisherId");

-- CreateIndex
CREATE INDEX "News_category_idx" ON "News"("category");

-- CreateIndex
CREATE UNIQUE INDEX "NewsBookmark_articleId_clientId_key" ON "NewsBookmark"("articleId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsVote_articleId_clientId_key" ON "NewsVote"("articleId", "clientId");

-- CreateIndex
CREATE INDEX "NewsComment_articleId_idx" ON "NewsComment"("articleId");

-- CreateIndex
CREATE INDEX "_NewsToTopic_B_index" ON "_NewsToTopic"("B");

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsBookmark" ADD CONSTRAINT "NewsBookmark_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "News"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsVote" ADD CONSTRAINT "NewsVote_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "News"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsComment" ADD CONSTRAINT "NewsComment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "News"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NewsToTopic" ADD CONSTRAINT "_NewsToTopic_A_fkey" FOREIGN KEY ("A") REFERENCES "News"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NewsToTopic" ADD CONSTRAINT "_NewsToTopic_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
