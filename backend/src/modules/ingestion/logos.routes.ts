/**
 * Serves the logo bytes logoResolver.ts stores in R2. Mounted at the app
 * root as /logos/publishers, matching the path Publisher.logoUrl actually
 * stores (see PUBLIC_PATH_PREFIX in logoResolver.ts) — not nested under
 * /api/ingestion.
 *
 * Bundled-SVG logos (paths like /logos/openai.svg, no "publishers/"
 * segment — see sourceLogos.ts) are NOT served here. Those are a frontend
 * static-asset concern (the Next.js app's own public/logos/), unrelated to
 * R2 and unaffected by this route.
 */
import { Hono } from "hono";
import type { R2Bucket } from "@cloudflare/workers-types";

const router = new Hono<{ Bindings: { LOGO_BUCKET: R2Bucket } }>();

router.get("/:filename", async (c) => {
  const filename = c.req.param("filename");
  const object = await c.env.LOGO_BUCKET.get(`publishers/${filename}`);
  if (!object) return c.notFound();

  return new Response(object.body as any, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      // Logos are resolved once and never change for a given filename (the
      // filename is derived from the domain) — safe to cache aggressively.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export default router;
