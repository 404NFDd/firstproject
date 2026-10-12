import { z } from "zod"
import { TECH_NEWS_CATEGORY_VALUES } from "@/lib/news-categories"

export const newsCategorySchema = z.enum(["100", "101", "102", "103", "104", "105", "106", "107", ...TECH_NEWS_CATEGORY_VALUES])

export const newsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  category: z.union([newsCategorySchema, z.literal("all"), z.literal("tech")]).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["latest", "priority", "popular"]).default("latest"),
  minPriority: z.coerce.number().int().min(0).max(1000).optional(),
})

export const newsSyncSchema = z.object({
  scope: z.enum(["tech", "all"]).default("tech"),
  categories: z.array(newsCategorySchema).min(1).max(13).optional(),
  limitPerCategory: z.number().int().min(1).max(50).optional(),
})
