import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const writeups = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./writeups",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    canonicalSlug: z.string(),
    readingTime: z.string(),
    sourceUrl: z.string().optional(),
  }),
});

export const collections = { writeups };