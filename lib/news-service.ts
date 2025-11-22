import { XMLParser } from "fast-xml-parser"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

const NEWS_API_ENDPOINT = "https://newsapi.org/v2/top-headlines"
const NEWS_API_COUNTRY = "kr"
const NAVER_SEARCH_API_ENDPOINT = "https://openapi.naver.com/v1/search/news.json"

export const SUPPORTED_NEWS_CATEGORIES = [
  "general",
  "business",
  "entertainment",
  "health",
  "science",
  "sports",
  "technology",
] as const

type NewsCategory = (typeof SUPPORTED_NEWS_CATEGORIES)[number]

// 네이버 검색 API 카테고리별 검색어 매핑
const NAVER_CATEGORY_QUERIES: Record<NewsCategory, string[]> = {
  general: ["뉴스", "속보", "오늘의 뉴스"],
  business: ["경제", "비즈니스", "금융", "주식"],
  entertainment: ["연예", "엔터테인먼트", "방송"],
  health: ["건강", "의료", "보건"],
  science: ["과학", "기술", "연구"],
  sports: ["스포츠", "운동", "경기"],
  technology: ["IT", "기술", "테크", "소프트웨어"],
}

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
const NAVER_CLIENT_ID_KEY = "CLIENT_ID"
const NAVER_CLIENT_SECRET_KEY = "CLIENT_SECRET"

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

// HTML 태그 제거 및 텍스트만 추출
const stripHtmlTags = (html?: string | null): string | undefined => {
  if (!html) return undefined

  // HTML 태그 제거
  let text = html.replace(/<[^>]*>/g, "")

  // HTML 엔티티 디코딩 (순서 중요: &amp;를 먼저 처리해야 함)
  text = text
    .replace(/&amp;/g, "&")  // 먼저 처리
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")

  // 연속된 공백 정리
  text = text.replace(/\s+/g, " ").trim()

  return text || undefined
}

// URL에서 Open Graph 이미지 추출
async function fetchImageFromUrl(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate: 3600 }, // 1시간 캐시
      signal: AbortSignal.timeout(5000), // 5초 타임아웃
    })

    if (!response.ok) {
      return undefined
    }

    const html = await response.text()

    // Open Graph 이미지 추출
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
    if (ogImageMatch && ogImageMatch[1]) {
      return ogImageMatch[1].trim()
    }

    // Twitter Card 이미지 추출 (대체)
    const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i)
    if (twitterImageMatch && twitterImageMatch[1]) {
      return twitterImageMatch[1].trim()
    }

    // 일반 이미지 메타 태그 추출
    const imageMatch = html.match(/<meta\s+name=["']image["']\s+content=["']([^"']+)["']/i)
    if (imageMatch && imageMatch[1]) {
      return imageMatch[1].trim()
    }

    return undefined
  } catch (error) {
    // 타임아웃이나 네트워크 오류는 조용히 무시
    return undefined
  }
}

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

    const validArticles = articles
      .map((item) => {
        const title = stripHtmlTags(item.title) || sanitizeString(item.title)
        const sourceUrl = sanitizeString(item.url)

        if (!title || !sourceUrl) {
          return null
        }

        const base: Omit<NormalizedArticle, "priority"> = {
          title,
          description: stripHtmlTags(item.description) || sanitizeString(item.description),
          content: stripHtmlTags(item.content) || sanitizeString(item.content),
          imageUrl: sanitizeString(item.urlToImage),
          sourceUrl,
          source: sanitizeString(item.source?.name) ?? "NewsAPI",
          author: sanitizeString(item.author),
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          category: options.category,
        }

        return base
      })
      .filter((item): item is Omit<NormalizedArticle, "priority"> => item !== null)

    return validArticles.map((base) => ({
      ...base,
      priority: calculatePriority(base),
    }))
  } catch (error) {
    console.error("Error fetching news from NewsAPI:", error)
    return []
  }
}

async function fetchNewsFromNaver(options: { category: NewsCategory; limit?: number }): Promise<NormalizedArticle[]> {
  const clientId = process.env[NAVER_CLIENT_ID_KEY]
  const clientSecret = process.env[NAVER_CLIENT_SECRET_KEY]

  if (!clientId || !clientSecret) {
    console.warn(`⚠️  ${NAVER_CLIENT_ID_KEY} 또는 ${NAVER_CLIENT_SECRET_KEY} 값이 없어 네이버 검색 API 호출을 건너뜁니다.`)
    return []
  }

  const queries = NAVER_CATEGORY_QUERIES[options.category] || ["뉴스"]
  const limitPerQuery = Math.ceil((options.limit ?? 20) / queries.length)
  const aggregated: NormalizedArticle[] = []

  for (const query of queries) {
    try {
      const url = new URL(NAVER_SEARCH_API_ENDPOINT)
      url.searchParams.set("query", query)
      url.searchParams.set("display", String(Math.min(limitPerQuery, 100)))
      url.searchParams.set("start", "1")
      url.searchParams.set("sort", "sim") // 정확도순

      const response = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        next: { revalidate: 60 },
      })

      if (!response.ok) {
        if (response.status === 403) {
          console.warn(`⚠️  네이버 검색 API 권한이 없습니다. 개발자 센터에서 검색 API를 활성화해주세요.`)
        } else {
          console.warn(`⚠️  네이버 검색 API 요청 실패: ${response.status}`)
        }
        continue
      }

      const data = await response.json()
      const items = data.items || []

      // 병렬로 이미지 추출 (성능 최적화)
      const itemsWithImages = await Promise.all(
        items.map(async (item: any) => {
          // HTML 태그 제거 및 엔티티 디코딩
          const cleanTitle = stripHtmlTags(item.title) || sanitizeString(item.title)
          const cleanDescription = stripHtmlTags(item.description) || sanitizeString(item.description)
          const sourceUrl = sanitizeString(item.originallink || item.link)

          if (!cleanTitle || !sourceUrl) return null

          // 원문 URL에서 이미지 추출 시도
          let imageUrl: string | undefined = undefined
          try {
            imageUrl = await fetchImageFromUrl(sourceUrl)
          } catch (error) {
            // 이미지 추출 실패는 조용히 무시
          }

          return {
            title: cleanTitle,
            description: cleanDescription,
            content: cleanDescription, // 네이버 API는 content를 제공하지 않으므로 description 사용
            imageUrl,
            sourceUrl,
            source: sanitizeString(new URL(sourceUrl).hostname.replace("www.", "")) || "네이버 뉴스",
            author: undefined, // 네이버 검색 API는 작성자 정보를 제공하지 않음
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            category: options.category,
          }
        })
      )

      // null 값 필터링 및 타입 안전성 확보
      const validItems = itemsWithImages.filter(
        (item): item is Omit<NormalizedArticle, "priority"> => item !== null && item.title !== undefined
      )

      for (const base of validItems) {
        aggregated.push({
          ...base,
          priority: calculatePriority(base),
        })
      }
    } catch (error) {
      console.error(`Error fetching news from Naver API (query: ${query}):`, error)
    }
  }

  return aggregated
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
        const rawTitle = item.title?.value || item.title
        const title = stripHtmlTags(rawTitle) || sanitizeString(rawTitle)
        const sourceUrl = sanitizeString(item.link?.href || item.link || item.guid)
        if (!title || !sourceUrl) continue

        const rawDescription = item.description?.value || item.description || item.summary
        const rawContent = item["content:encoded"] || item.content?.value || item.summary

        const base = {
          title,
          description: stripHtmlTags(rawDescription) || sanitizeString(rawDescription),
          content: stripHtmlTags(rawContent) || sanitizeString(rawContent),
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
  includeNaver?: boolean
  rssLimit?: number
}): Promise<NewsIngestResult> {
  const categories = options?.categories ?? SUPPORTED_NEWS_CATEGORIES
  const limitPerCategory = options?.limitPerCategory ?? 20
  const includeRss = options?.includeRss ?? true
  const includeNaver = options?.includeNaver ?? true

  const collected: NormalizedArticle[] = []

  for (const category of categories) {
    // NewsAPI에서 뉴스 가져오기
    const apiArticles = await fetchNewsFromAPI({ category, limit: limitPerCategory })
    collected.push(...apiArticles)

    // 네이버 검색 API에서 뉴스 가져오기
    if (includeNaver) {
      const naverArticles = await fetchNewsFromNaver({ category, limit: limitPerCategory })
      collected.push(...naverArticles)
    }
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
    if (query.category && query.category !== "all" && query.category !== "general") {
      where.category = query.category
    }
    if (query.search) {
      const search = query.search
      // PostgreSQL과 SQLite는 case-sensitive가 기본이므로 mode: "insensitive" 필요
      // MySQL은 기본적으로 case-insensitive이므로 mode 옵션 불필요
      const dbUrl = process.env.DATABASE_URL || ""
      const isPostgreSQL = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://")
      const isSQLite = dbUrl.startsWith("file:") || dbUrl.startsWith("sqlite:")
      const useInsensitive = isPostgreSQL || isSQLite

      if (useInsensitive) {
        // PostgreSQL/SQLite: case-insensitive 검색 필요
        where.OR = [
          { title: { contains: search, mode: "insensitive" } as Prisma.StringFilter<"News"> },
          { description: { contains: search, mode: "insensitive" } as Prisma.StringNullableFilter<"News"> },
          { content: { contains: search, mode: "insensitive" } as Prisma.StringNullableFilter<"News"> },
        ]
      } else {
        // MySQL: 기본적으로 case-insensitive
        where.OR = [
          { title: { contains: search } },
          { description: { contains: search } },
          { content: { contains: search } },
        ]
      }
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
