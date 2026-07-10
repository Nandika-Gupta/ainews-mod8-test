import { z } from "zod";

export const newsSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export type NewsSlugParamInput = z.infer<typeof newsSlugParamSchema>;
