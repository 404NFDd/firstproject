import { newsQuerySchema } from "@/lib/news-validation"

export function readNewsListFilters(params: { get(name: string): string | null }) {
  const category = newsQuerySchema.shape.category.safeParse(params.get("category") || "tech")
  const search = newsQuerySchema.shape.search.safeParse(params.get("q") || params.get("search") || "")
  const sort = newsQuerySchema.shape.sort.safeParse(params.get("sort") || "latest")
  return {
    category: category.success ? category.data || "tech" : "tech",
    search: search.success ? search.data || "" : "",
    sort: sort.success ? sort.data : "latest" as const,
  }
}

export function newsListQuery(filters: ReturnType<typeof readNewsListFilters>) {
  const params = new URLSearchParams({ category: filters.category })
  if (filters.search) params.set("q", filters.search)
  if (filters.sort !== "latest") params.set("sort", filters.sort)
  return params.toString()
}
