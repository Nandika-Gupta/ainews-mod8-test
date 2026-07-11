/**
 * Keeps the live News table bounded — running unbounded on a cron makes
 * every ingest slower (near-duplicate title check scans a growing window,
 * more publishers to resolve logos for) and the deployed app heavier for no
 * real benefit, since a news aggregator's value is in recent coverage, not
 * an ever-growing archive. Called at the end of every ingestion run —
 * deletes the oldest articles beyond the cap, by publishedAt, along with
 * their dependent NewsBookmark/NewsVote/NewsComment rows. Publisher and
 * Topic rows are never touched.
 *
 * Ported from the old ainews-mod8 app's ingestion/prune.ts with two
 * changes:
 *   - `keep` default dropped from 200 to 150.
 *   - Added NewsComment cleanup. The old schema had no Comment model, so
 *     the old prune only cleaned up Vote/Bookmark rows. Our NewsComment.
 *     articleId is ON DELETE RESTRICT (same as NewsVote/NewsBookmark) — a
 *     mechanical rename without this addition would throw a foreign-key
 *     violation on the first prune of any article that ever got a comment.
 */
import type { PrismaClient } from "@prisma/client";

export async function pruneToMostRecent(prisma: PrismaClient, keep = 150): Promise<number> {
  const idsToDelete = await prisma.news.findMany({
    orderBy: { publishedAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  const ids = idsToDelete.map((r) => r.id);
  if (ids.length === 0) return 0;

  await prisma.$transaction([
    prisma.newsVote.deleteMany({ where: { articleId: { in: ids } } }),
    prisma.newsBookmark.deleteMany({ where: { articleId: { in: ids } } }),
    prisma.newsComment.deleteMany({ where: { articleId: { in: ids } } }),
    prisma.news.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return ids.length;
}
