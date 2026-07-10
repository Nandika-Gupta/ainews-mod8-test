import { z } from "zod";

export const newsSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export type NewsSlugParamInput = z.infer<typeof newsSlugParamSchema>;

// clientId is an anonymous, client-generated id (no real auth module exists
// yet) — same pattern as NewsVote/NewsBookmark/NewsComment's clientId column.

export const newsVoteBodySchema = z.object({
  clientId: z.string().min(1),
  value: z.union([z.literal(1), z.literal(-1)]),
});

export type NewsVoteBodyInput = z.infer<typeof newsVoteBodySchema>;

export const newsBookmarkBodySchema = z.object({
  clientId: z.string().min(1),
});

export type NewsBookmarkBodyInput = z.infer<typeof newsBookmarkBodySchema>;

export const newsBookmarkQuerySchema = z.object({
  clientId: z.string().min(1),
});

export type NewsBookmarkQueryInput = z.infer<typeof newsBookmarkQuerySchema>;

export const newsCommentBodySchema = z.object({
  clientId: z.string().min(1),
  authorName: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(2000),
});

export type NewsCommentBodyInput = z.infer<typeof newsCommentBodySchema>;
