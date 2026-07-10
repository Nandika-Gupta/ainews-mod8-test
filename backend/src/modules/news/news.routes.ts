import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { newsSlugParamSchema } from "./news.schemas.js";
import { NewsController } from "./news.controller.js";

const router = new Hono<{ Bindings: { DATABASE_URL: string } }>();

router.get("/", NewsController.getListing);
router.get("/:slug", zValidator("param", newsSlugParamSchema), NewsController.getDetail);

export default router;
