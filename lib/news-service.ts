import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const SUPPORTED_NEWS_CATEGORIES = [
  "general",
  "business",
  "entertainment",
  "health",
  "science",
  "sports",
  "technology",
  "developer",
] as const

type NewsCategory = (typeof SUPPORTED_NEWS_CATEGORIES)[number]

// 네이버 뉴스 섹션 URL 매핑 (HTML 크롤링용)
const NAVER_SECTION_URLS: Partial<Record<NewsCategory, string>> = {
  general: "https://news.naver.com",
  business: "https://news.naver.com/section/101", // 경제
  entertainment: "https://news.naver.com/section/106", // 연예
  health: "https://news.naver.com/section/103", // 사회(건강 관련 포함)
  science: "https://news.naver.com/section/105", // IT/과학
  sports: "https://sports.news.naver.com/index",
  technology: "https://news.naver.com/section/105", // IT/과학
  developer: "https://news.naver.com/section/105", // 개발자 뉴스는 IT/과학에서 추출
}

const CATEGORY_PRIORITY_WEIGHT: Record<string, number> = {
  general: 10,
  business: 8,
  entertainment: 4,
  health: 6,
  science: 7,
  sports: 5,
  technology: 9,
  developer: 9,
}

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

// 개발자 관련 키워드 감지 함수
function detectDeveloperCategory(article: { title: string; description?: string; content?: string }): boolean {
  const keywords = [
    "개발자", "프로그래밍", "코딩", "소프트웨어 개발", "개발 이슈", "프로그래머", "개발자 뉴스",
    "developer", "programming", "coding", "software engineer", "software development",
    "프론트엔드", "백엔드", "풀스택", "frontend", "backend", "fullstack",
    "알고리즘", "데이터구조", "algorithm", "data structure",
    "개발 도구", "IDE", "에디터", "개발 환경",
    "오픈소스", "open source", "github", "git",
    "스타트업 개발", "스타트업 기술", "startup tech",
  ]
  const text = `${article.title} ${article.description || ""} ${article.content || ""}`.toLowerCase()
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

// 간단한 한국어 감지 함수 (한글 유니코드 범위 체크)
function isKorean(text: string): boolean {
  // 한글 유니코드 범위: AC00-D7AF (완성형), 1100-11FF (자모), 3130-318F (호환 자모)
  const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/
  return koreanRegex.test(text)
}

// Google Cloud Translation API를 사용하여 텍스트를 한국어로 번역
export async function translateToKorean(text: string | undefined | null): Promise<string | undefined> {
  if (!text || !text.trim()) return undefined

  // 이미 한국어인 경우 번역하지 않음
  if (isKorean(text)) {
    return text
  }

  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY
  if (!apiKey) {
    console.warn("⚠️  GOOGLE_TRANSLATE_API_KEY가 설정되지 않아 번역을 건너뜁니다.")
    return text // 번역 실패 시 원문 반환
  }

  try {
    // 개행 문자 확인 (디버깅용)
    const hasNewlines = text.includes("\n")
    if (hasNewlines) {
      console.log(`📝 번역 전 텍스트에 개행 발견: ${text.split("\n").length - 1}개`)
    }

    // 개행 문자를 임시 마커로 치환하여 보존
    const NEWLINE_MARKER = "___NEWLINE___"
    const DOUBLE_NEWLINE_MARKER = "___DOUBLE_NEWLINE___"

    // 연속된 개행을 먼저 처리 (2개 이상)
    let textWithMarkers = text.replace(/\n\n+/g, DOUBLE_NEWLINE_MARKER)
    // 단일 개행 처리
    textWithMarkers = textWithMarkers.replace(/\n/g, NEWLINE_MARKER)

    // Google Cloud Translation API v2 REST API 사용
    // 문서 참고: https://docs.cloud.google.com/translate/docs/reference/rpc/google.cloud.translate.v2
    // q는 배열로 전달 (최대 128개), format은 "text" (plain text)
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: [textWithMarkers], // TranslateTextRequest.q[] - 배열로 전달 (최대 128개)
        target: "ko", // TranslateTextRequest.target - 타겟 언어 (필수)
        format: "text", // TranslateTextRequest.format - "html" 또는 "text" (기본값: "html")
        // source는 생략하면 자동 감지 (TranslateTextRequest.source - 선택사항)
      }),
      signal: AbortSignal.timeout(10000), // 10초 타임아웃
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error(`⚠️  번역 API 요청 실패: ${response.status} ${response.statusText}`)
      if (errorText) {
        try {
          const errorData = JSON.parse(errorText)
          console.error(`   오류 내용:`, errorData.error?.message || errorText.substring(0, 200))
        } catch {
          console.error(`   응답 내용: ${errorText.substring(0, 200)}`)
        }
      }
      return text // 번역 실패 시 원문 반환
    }

    const data = await response.json()

    // 에러 응답 체크
    if (data.error) {
      console.error(`⚠️  번역 API 오류:`, data.error)
      return text
    }

    // TranslateTextResponse 형식: data.translations[].translated_text
    // REST API는 snake_case를 사용할 수 있으므로 두 가지 형식 모두 확인
    const translation = data?.data?.translations?.[0]
    const translatedText = translation?.translated_text || translation?.translatedText

    if (translatedText) {
      // 마커를 다시 개행 문자로 복원
      let restoredText = translatedText
        .replace(new RegExp(DOUBLE_NEWLINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "\n\n")
        .replace(new RegExp(NEWLINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "\n")

      // 복원 후 개행 확인 (디버깅용)
      if (hasNewlines) {
        const restoredNewlines = restoredText.split("\n").length - 1
        console.log(`✅ 번역 후 개행 복원: ${restoredNewlines}개`)
      }

      return restoredText
    }

    return text // 번역 결과가 없으면 원문 반환
  } catch (error) {
    console.error("⚠️  번역 중 오류 발생:", error)
    if (error instanceof Error) {
      console.error(`   오류 메시지: ${error.message}`)
    }
    return text // 오류 발생 시 원문 반환
  }
}

// HTML 태그 제거 및 텍스트만 추출 (개행 보존 옵션)
const stripHtmlTags = (html?: string | null, preserveNewlines = false): string | undefined => {
  if (!html) return undefined

  let text = html

  // HTML 블록 태그를 개행으로 변환 (개행 보존 모드일 때)
  if (preserveNewlines) {
    // 블록 태그를 개행으로 변환
    text = text
      .replace(/<\/p>/gi, "\n\n")  // </p> -> 두 개행
      .replace(/<p[^>]*>/gi, "")   // <p> 제거
      .replace(/<\/div>/gi, "\n")   // </div> -> 개행
      .replace(/<div[^>]*>/gi, "")  // <div> 제거
      .replace(/<br\s*\/?>/gi, "\n") // <br> -> 개행
      .replace(/<\/li>/gi, "\n")    // </li> -> 개행
      .replace(/<li[^>]*>/gi, "- ")  // <li> -> "- "
      .replace(/<\/h[1-6]>/gi, "\n\n") // 헤딩 -> 두 개행
      .replace(/<h[1-6][^>]*>/gi, "")  // 헤딩 시작 태그 제거
  }

  // HTML 태그 제거
  text = text.replace(/<[^>]*>/g, "")

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
    .replace(/&#10;/g, "\n")  // 개행 엔티티
    .replace(/&#13;/g, "\r")  // 캐리지 리턴

  if (preserveNewlines) {
    // 개행 보존 모드: 연속된 공백만 정리 (개행은 유지)
    // 연속된 공백(개행 제외)을 단일 공백으로
    text = text.replace(/[ \t]+/g, " ")
    // 연속된 개행을 최대 2개로 제한
    text = text.replace(/\n{3,}/g, "\n\n")
    return text.trim() || undefined
  } else {
    // 기존 모드: 모든 공백(개행 포함)을 단일 공백으로
    text = text.replace(/\s+/g, " ").trim()
    return text || undefined
  }
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
    const baseUrl = new URL(url) // 원본 URL의 base URL

    // 상대 경로를 절대 URL로 변환하는 헬퍼 함수
    const resolveUrl = (imageUrl: string): string => {
      // 이미 절대 URL이면 그대로 반환
      if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
        return imageUrl
      }
      // 상대 경로면 base URL과 결합
      try {
        return new URL(imageUrl, baseUrl.origin).href
      } catch {
        return imageUrl
      }
    }

    // Open Graph 이미지 추출
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
    if (ogImageMatch && ogImageMatch[1]) {
      return resolveUrl(ogImageMatch[1].trim())
    }

    // Twitter Card 이미지 추출 (대체)
    const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i)
    if (twitterImageMatch && twitterImageMatch[1]) {
      return resolveUrl(twitterImageMatch[1].trim())
    }

    // 일반 이미지 메타 태그 추출
    const imageMatch = html.match(/<meta\s+name=["']image["']\s+content=["']([^"']+)["']/i)
    if (imageMatch && imageMatch[1]) {
      return resolveUrl(imageMatch[1].trim())
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

// 네이버 뉴스 HTML을 직접 크롤링하는 헬퍼 함수
async function fetchNaverSectionHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      console.warn(`⚠️  네이버 뉴스 HTML 요청 실패: ${response.status} (${url})`)
      return null
    }

    return await response.text()
  } catch (error) {
    console.error("⚠️  네이버 뉴스 HTML 요청 중 오류:", error)
    return null
  }
}

function parseKoreanDateTime(text: string): Date | null {
  // Examples:
  // - 2026.03.18. 오전 10:20
  // - 2026.03.18. 오후 3:05
  // - 2026.03.18. 15:05
  const normalized = text.replace(/\s+/g, " ").trim()
  const m = normalized.match(
    /(\d{4})\.(\d{2})\.(\d{2})\.\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  )
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  let hour = Number(m[5])
  const minute = Number(m[6])
  const second = Number(m[7] ?? "0")

  if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) return null

  const ampm = m[4]
  if (ampm === "오전") {
    if (hour === 12) hour = 0
  } else if (ampm === "오후") {
    if (hour < 12) hour += 12
  }

  // Treat parsed time as Asia/Seoul (UTC+9) then convert to UTC Date.
  const utcMillis = Date.UTC(year, month - 1, day, hour - 9, minute, second)
  const dObj = new Date(utcMillis)
  return Number.isNaN(dObj.getTime()) ? null : dObj
}

function parseNaverPublishedAt(contextHtml: string): Date | null {
  // 1) data-date-time="2026-03-18 10:20:00" (common on list items)
  const dataDateTime = contextHtml.match(/data-date-time=["'](\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)["']/i)
  if (dataDateTime?.[1]) {
    const raw = dataDateTime[1].replace(" ", "T")
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (m) {
      const year = Number(m[1])
      const month = Number(m[2])
      const day = Number(m[3])
      const hour = Number(m[4])
      const minute = Number(m[5])
      const second = Number(m[6] ?? "0")
      const utcMillis = Date.UTC(year, month - 1, day, hour - 9, minute, second)
      const dt = new Date(utcMillis)
      if (!Number.isNaN(dt.getTime())) return dt
    }
  }

  // 2) datetime="2026-03-18T10:20:00+09:00" or "2026-03-18T10:20:00"
  const datetimeAttr = contextHtml.match(
    /datetime=["'](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)["']/i,
  )
  if (datetimeAttr?.[1]) {
    const dt = new Date(datetimeAttr[1])
    if (!Number.isNaN(dt.getTime())) return dt
  }

  // 3) Visible Korean timestamp text
  // Try to find a nearby datetime-like text block.
  const koreanTextMatch = contextHtml.match(/(\d{4}\.\d{2}\.\d{2}\.\s*(?:오전|오후)?\s*\d{1,2}:\d{2}(?::\d{2})?)/)
  if (koreanTextMatch?.[1]) {
    const dt = parseKoreanDateTime(koreanTextMatch[1])
    if (dt) return dt
  }

  return null
}

// 네이버 뉴스 HTML에서 기사 정보 추출
function parseNaverNewsHtml(html: string, category: NewsCategory): Omit<NormalizedArticle, "priority">[] {
  const articles: Omit<NormalizedArticle, "priority">[] = []

  // 대표적인 네이버 뉴스 리스트 패턴들에 대응하기 위한 단순 파서
  // - 메인/섹션: <a ... class="cluster_text_headline" ... href="...">제목</a>
  // - 또는: <a ... class="sa_text_title" ... href="...">제목</a>
  // NOTE: HTML 속성 순서는 보장되지 않으므로, <a> 태그 전체에서 class/href를 각각 추출한다.
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi

  const stripInnerHtml = (value: string) => stripHtmlTags(value, false) || sanitizeString(value)
  const extractAttr = (attrs: string, name: string): string | undefined => {
    const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))
    return m?.[1] ? m[1] : undefined
  }

  let match: RegExpExecArray | null
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1] ?? ""
    const rawTitle = match[2] ?? ""

    const classAttr = extractAttr(attrs, "class") ?? ""
    if (!/(^|\s)(cluster_text_headline|sa_text_title)(\s|$)/.test(classAttr)) {
      continue
    }

    const href = extractAttr(attrs, "href")
    const title = rawTitle ? stripInnerHtml(rawTitle) : undefined

    if (!href || !title) continue

    let sourceUrl: string | undefined
    try {
      // 상대 경로일 경우 네이버 도메인 기준으로 변환
      if (href.startsWith("http://") || href.startsWith("https://")) {
        sourceUrl = href
      } else {
        sourceUrl = new URL(href, "https://news.naver.com").href
      }
    } catch {
      continue
    }

    const source = "네이버 뉴스"
    const contextStart = Math.max(0, match.index)
    const contextEnd = Math.min(html.length, contextStart + 2000)
    const contextHtml = html.slice(contextStart, contextEnd)

    // HTML에서 발행일을 찾지 못하면, 전부 같은 값이 되지 않도록 약간씩 과거로 분산
    const fallbackPublishedAt = new Date(Date.now() - articles.length * 60_000)
    const publishedAt = parseNaverPublishedAt(contextHtml) ?? fallbackPublishedAt

    articles.push({
      title,
      description: undefined,
      content: undefined,
      imageUrl: undefined,
      sourceUrl,
      source,
      author: undefined,
      publishedAt,
      category,
    })
  }

  return articles
}

// 네이버 HTML 크롤러: 섹션별로 HTML을 가져와 NormalizedArticle로 변환
async function fetchNewsFromNaverHtml(options: {
  categories: NewsCategory[]
  limitPerCategory?: number
}): Promise<NormalizedArticle[]> {
  const limitPerCategory = options.limitPerCategory ?? 20
  const aggregated: NormalizedArticle[] = []

  for (let i = 0; i < options.categories.length; i++) {
    const category = options.categories[i]
    const sectionUrl = NAVER_SECTION_URLS[category]
    if (!sectionUrl) {
      continue
    }

    // 카테고리 간 간단한 딜레이로 요청 속도 제어
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 700))
    }

    const html = await fetchNaverSectionHtml(sectionUrl)
    if (!html) continue

    const baseArticles = parseNaverNewsHtml(html, category).slice(0, limitPerCategory)

    for (const base of baseArticles) {
      const finalCategory = detectDeveloperCategory(base) ? "developer" : base.category
      aggregated.push({
        ...base,
        category: finalCategory,
        priority: calculatePriority({ ...base, category: finalCategory }),
      })
    }
  }

  return aggregated
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
        // 네이버 HTML 크롤링 기반 수집이므로 기본적으로 한국어 기사로 간주
        isTranslated: 1,
      },
    })
    persisted += 1
  }

  return { fetched: articles.length, persisted, skipped }
}

async function fetchNewsFromAPI(options: { category: NewsCategory; limit?: number }): Promise<NormalizedArticle[]> {
  console.warn("⚠️  fetchNewsFromAPI는 더 이상 사용되지 않습니다. 네이버 HTML 크롤러를 사용하세요.")
  return []
}

export async function ingestLatestNews(options?: {
  categories?: NewsCategory[]
  limitPerCategory?: number
}): Promise<NewsIngestResult> {
  const categories =
    options?.categories && options.categories.length > 0
      ? options.categories
      : [...SUPPORTED_NEWS_CATEGORIES]
  const limitPerCategory = options?.limitPerCategory ?? 20

  const naverArticles = await fetchNewsFromNaverHtml({ categories, limitPerCategory })
  const deduped = dedupeArticles(naverArticles)
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
