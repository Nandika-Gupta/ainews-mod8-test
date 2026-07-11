import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { R2Bucket } from "@cloudflare/workers-types";
import { ingestionRunQuerySchema } from "./ingestion.schemas.js";
import { IngestionController } from "./ingestion.controller.js";

const router = new Hono<{ Bindings: { DATABASE_URL: string; GEMINI_API_KEY: string; GROQ_API_KEY: string; LOGO_BUCKET: R2Bucket } }>();

router.post("/run", zValidator("query", ingestionRunQuerySchema), IngestionController.run);

export default router;
