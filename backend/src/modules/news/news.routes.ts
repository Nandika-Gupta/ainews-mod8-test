import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  newsSlugParamSchema,
  newsVoteBodySchema,
  newsBookmarkBodySchema,
  newsBookmarkQuerySchema,
  newsCommentBodySchema,
} from "./news.schemas.js";
import { NewsController } from "./news.controller.js";

const router = new Hono<{ Bindings: { DATABASE_URL: string } }>();

router.get("/", NewsController.getListing);
router.get("/:slug", zValidator("param", newsSlugParamSchema), NewsController.getDetail);

router.post(
  "/:slug/vote",
  zValidator("param", newsSlugParamSchema),
  zValidator("json", newsVoteBodySchema),
  NewsController.postVote
);

router.post(
  "/:slug/bookmark",
  zValidator("param", newsSlugParamSchema),
  zValidator("json", newsBookmarkBodySchema),
  NewsController.postBookmark
);

router.delete(
  "/:slug/bookmark",
  zValidator("param", newsSlugParamSchema),
  zValidator("query", newsBookmarkQuerySchema),
  NewsController.deleteBookmark
);

router.post(
  "/:slug/comments",
  zValidator("param", newsSlugParamSchema),
  zValidator("json", newsCommentBodySchema),
  NewsController.postComment
);

export default router;
