import { XMLParser } from "fast-xml-parser"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

const NEWS_API_ENDPOINT = "https://newsapi.org/v2/top-headlines"
const NEWS_API_COUNTRY = "kr"

export const SUPPORTED_NEWS_CATEGORIES = [
  "general",
  "business",
  "entertainment",
  "health",
  "science",
  "sports",
  "technology",
] as const

const CATEGORY_PRIORITY_WEIGHT: Record<string, number> = {
  general: 10,
  business: 8,
  entertainment: 4,
  health: 6,
  science: 7,
  sports: 5,
  technology: 9,
}

const RSS_FEEDS = [
  { category: "technology", url: "https://www.techmeme.com/feed.xml" },
  { category: "business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { category: "science", url: "https://www.sciencemag.org/rss/news_current.xml" },
  { category: "general", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
]

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
})

type NewsCategory = (typeof SUPPORTED_NEWS_CATEGORIES)[number]

type NormalizedArticle = {
  title: string
  description?: string
  content?: string
  imageUrl?: string
  sourceUrl?: string
  source: string
  author?: string
  publishedAt: Date
  category: string
  priority: number
}

type NewsQuery = {
  page?: number
  limit?: number
  category?: string
  search?: string
  sort?: "latest" | "priority" | "popular"
  minPriority?: number
}

export type NewsIngestResult = {
  fetched: number
  persisted: number
  skipped: number
}

const REQUIRED_ENV_KEY = "NEWS_API_KEY"

const DEFAULT_QUERY: Required<Pick<NewsQuery, "limit" | "page" | "sort">> = {
  page: 1,
  limit: 12,
  sort: "latest",
}

const normalizeCategory = (category?: string | null): NewsCategory => {
  if (!category) return "general"
  return (SUPPORTED_NEWS_CATEGORIES.includes(category as NewsCategory) ? category : "general") as NewsCategory
}

const sanitizeString = (value?: string | null) => value?.trim() || undefined

const calculatePriority = (article: Omit<NormalizedArticle, "priority">): number => {
  const now = Date.now()
  const ageInHours = Math.max(0, (now - article.publishedAt.getTime()) / 36e5)
  const freshnessScore = Math.max(0, 100 - ageInHours * 4) // decay 4pts/hour
  const categoryWeight = CATEGORY_PRIORITY_WEIGHT[article.category] ?? 0
  const hasImageBonus = article.imageUrl ? 3 : 0
  return Math.round(freshnessScore + categoryWeight + hasImageBonus)
}

const dedupeArticles = (articles: NormalizedArticle[]): NormalizedArticle[] => {
  const seen = new Map<string, NormalizedArticle>()
  for (const article of articles) {
    const key = article.sourceUrl ?? article.title
    if (!seen.has(key)) {
      seen.set(key, article)
    }
  }
  return Array.from(seen.values())
}

async function persistArticles(articles: NormalizedArticle[]): Promise<NewsIngestResult> {
  let persisted = 0
  let skipped = 0

  for (const article of articles) {
    const uniqueFilters: Prisma.NewsWhereInput[] = []
    if (article.sourceUrl) {
      uniqueFilters.push({ sourceUrl: article.sourceUrl })
    }
    uniqueFilters.push({ title: article.title })

    const existing = await prisma.news.findFirst({
      where: { OR: uniqueFilters },
      select: { id: true },
    })

    if (existing) {
      skipped += 1
      continue
    }

    await prisma.news.create({
      data: {
        title: article.title,
        description: article.description,
        content: article.content,
        imageUrl: article.imageUrl,
        sourceUrl: article.sourceUrl,
        source: article.source,
        author: article.author,
        publishedAt: article.publishedAt,
        category: article.category,
        priority: article.priority,
      },
    })
    persisted += 1
  }

  return { fetched: articles.length, persisted, skipped }
}

async function fetchNewsFromAPI(options: { category: NewsCategory; limit?: number }): Promise<NormalizedArticle[]> {
  if (!process.env[REQUIRED_ENV_KEY]) {
    console.warn(`⚠️  ${REQUIRED_ENV_KEY} 값이 없어 NewsAPI 호출을 건너뜁니다.`)
    return []
  }

  const url = new URL(NEWS_API_ENDPOINT)
  url.searchParams.set("apiKey", process.env[REQUIRED_ENV_KEY] as string)
  url.searchParams.set("country", NEWS_API_COUNTRY)
  url.searchParams.set("pageSize", String(options.limit ?? 20))
  url.searchParams.set("category", options.category)

  try {
    const response = await fetch(url, { next: { revalidate: 60 } })
    if (!response.ok) {
      throw new Error(`NewsAPI 요청 실패: ${response.status}`)
    }

    const data = await response.json()
    const articles = (data.articles || []) as any[]

    return articles
      .map((item) => {
        const base = {
          title: sanitizeString(item.title),
          description: sanitizeString(item.description),
          content: sanitizeString(item.content),
          imageUrl: sanitizeString(item.urlToImage),
          sourceUrl: sanitizeString(item.url),
          source: sanitizeString(item.source?.name) ?? "NewsAPI",
          author: sanitizeString(item.author),
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          category: options.category,
        }

        if (!base.title || !base.sourceUrl) {
          return null
        }

        return {
          ...base,
          priority: calculatePriority(base),
        } satisfies NormalizedArticle
      })
      .filter(Boolean) as NormalizedArticle[]
  } catch (error) {
    console.error("Error fetching news from NewsAPI:", error)
    return []
  }
}

async function fetchFromRssFeeds(limitPerFeed = 10): Promise<NormalizedArticle[]> {
  const aggregated: NormalizedArticle[] = []

  for (const feed of RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, { cache: "no-store" })
      if (!response.ok) {
        console.warn(`⚠️  RSS(${feed.url}) 요청 실패: ${response.status}`)
        continue
      }

      const xml = await response.text()
      const parsed = xmlParser.parse(xml)
      const items =
        parsed?.rss?.channel?.item ||
        parsed?.feed?.entry ||
        parsed?.channel?.item ||
        []

      for (const item of items.slice(0, limitPerFeed)) {
        const title = sanitizeString(item.title?.value || item.title)
        const sourceUrl = sanitizeString(item.link?.href || item.link || item.guid)
        if (!title || !sourceUrl) continue

        const base = {
          title,
          description: sanitizeString(item.description?.value || item.description || item.summary),
          content: sanitizeString(item["content:encoded"] || item.content?.value || item.summary),
          imageUrl: sanitizeString(item.enclosure?.url || item["media:content"]?.url),
          sourceUrl,
          source: sanitizeString(item.source?.value) ?? new URL(sourceUrl).hostname,
          author: sanitizeString(item.author?.name || item["dc:creator"]),
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          category: feed.category,
        }

        aggregated.push({
          ...base,
          priority: calculatePriority(base),
        })
      }
    } catch (error) {
      console.error("Error parsing RSS feed:", feed.url, error)
    }
  }

  return aggregated
}

export async function ingestLatestNews(options?: {
  categories?: NewsCategory[]
  limitPerCategory?: number
  includeRss?: boolean
  rssLimit?: number
}): Promise<NewsIngestResult> {
  const categories = options?.categories ?? SUPPORTED_NEWS_CATEGORIES
  const limitPerCategory = options?.limitPerCategory ?? 20
  const includeRss = options?.includeRss ?? true

  const collected: NormalizedArticle[] = []

  for (const category of categories) {
    const apiArticles = await fetchNewsFromAPI({ category, limit: limitPerCategory })
    collected.push(...apiArticles)
  }

  if (includeRss) {
    const rssArticles = await fetchFromRssFeeds(options?.rssLimit ?? 8)
    collected.push(...rssArticles)
  }

  const deduped = dedupeArticles(collected)
  return persistArticles(deduped)
}

export async function getNews(query: NewsQuery = {}) {
  try {
    const { page, limit, sort } = { ...DEFAULT_QUERY, ...query }
    const skip = (page - 1) * limit

    const where: Prisma.NewsWhereInput = {}
    if (query.category && query.category !== "all") {
      where.category = query.category
    }
    if (query.search) {
      const search = query.search
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ]
    }
    if (typeof query.minPriority === "number") {
      where.priority = { gte: query.minPriority }
    }

    const orderBy: Prisma.NewsOrderByWithRelationInput[] = []
    if (sort === "priority") {
      orderBy.push({ priority: "desc" })
    } else if (sort === "popular") {
      orderBy.push({ readHistory: { _count: "desc" } })
    }
    orderBy.push({ publishedAt: "desc" })

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.news.count({ where }),
    ])

    return {
      news,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error getting news:", error)
    return { news: [], pagination: { total: 0, page: 1, limit: query.limit ?? DEFAULT_QUERY.limit, pages: 0 } }
  }
}

export async function getNewsDetail(newsId: string) {
  try {
    return await prisma.news.findUnique({
      where: { id: newsId },
      include: {
        bookmarks: true,
        readHistory: true,
      },
    })
  } catch (error) {
    console.error("Error getting news detail:", error)
    return null
  }
}

export async function searchNews(query: string, page = 1, limit = 10) {
  return getNews({ search: query, page, limit })
}

export async function getUserBookmarks(userId: string, page = 1, limit = 10) {
  try {
    const skip = (page - 1) * limit

    const [bookmarks, total] = await Promise.all([
      prisma.newsBookmark.findMany({
        where: { userId },
        include: { news: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.newsBookmark.count({ where: { userId } }),
    ])

    return {
      bookmarks: bookmarks.map((b) => b.news),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error getting user bookmarks:", error)
    return { bookmarks: [], pagination: { total: 0, page: 1, limit, pages: 0 } }
  }
}
