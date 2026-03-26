import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const SUPPORTED_NEWS_CATEGORIES = [
  // 네이버 뉴스 섹션 번호(표준 카테고리 8개)
  "100", // 정치
  "101", // 경제
  "102", // 사회
  "103", // 생활·문화
  "104", // 세계
  "105", // IT·과학
  "106", // 연예
  "107", // 스포츠
] as const

type NewsCategory = (typeof SUPPORTED_NEWS_CATEGORIES)[number]

// 네이버 뉴스 섹션 URL 매핑 (HTML 크롤링용)
const NAVER_SECTION_URLS: Partial<Record<NewsCategory, string>> = {
  "100": "https://news.naver.com/section/100",
  "101": "https://news.naver.com/section/101",
  "102": "https://news.naver.com/section/102",
  "103": "https://news.naver.com/section/103",
  "104": "https://news.naver.com/section/104",
  "105": "https://news.naver.com/section/105",
  "106": "https://news.naver.com/section/106",
  "107": "https://news.naver.com/section/107",
}

const CATEGORY_PRIORITY_WEIGHT: Record<string, number> = {
  "100": 9, // 정치
  "101": 8, // 경제
  "102": 8, // 사회
  "103": 6, // 생활·문화
  "104": 7, // 세계
  "105": 8, // IT·과학
  "106": 5, // 연예
  "107": 5, // 스포츠
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

const sanitizeString = (value?: string | null) => value?.trim() || undefined


// HTML 태그 제거 및 텍스트만 추출 (개행 보존 옵션)
// HTML 정리 유틸
// Input: HTML 문자열, preserveNewlines(개행 보존 여부)
// Output: 태그/엔티티가 정리된 평문 문자열
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
// URL 페이지에서 대표 이미지 메타 태그(og/twitter)를 추출
// Input: 원문 기사 URL
// Output: 이미지 URL 또는 undefined
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

// 기사 우선순위 계산
// Input: 우선순위를 제외한 기사 정보
// Output: 신선도/카테고리/이미지 보너스를 합산한 점수
const calculatePriority = (article: Omit<NormalizedArticle, "priority">): number => {
  const now = Date.now()
  const ageInHours = Math.max(0, (now - article.publishedAt.getTime()) / 36e5)
  const freshnessScore = Math.max(0, 100 - ageInHours * 4) // decay 4pts/hour
  const categoryWeight = CATEGORY_PRIORITY_WEIGHT[article.category] ?? 0
  const hasImageBonus = article.imageUrl ? 3 : 0
  return Math.round(freshnessScore + categoryWeight + hasImageBonus)
}

// 중복 기사 제거
// Input: 기사 배열
// Output: sourceUrl(없으면 title) 기준으로 dedupe된 배열
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

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch {
    return null
  }
}

function extractMetaContent(html: string, key: string): string | undefined {
  // property="og:image" content="..."
  const propRe = new RegExp(`<meta\\s+[^>]*property=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i")
  const nameRe = new RegExp(`<meta\\s+[^>]*name=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i")
  const tag = html.match(propRe)?.[0] ?? html.match(nameRe)?.[0]
  if (!tag) return undefined

  const content = tag.match(/content=["']([^"']+)["']/i)?.[1]
  return content ? content.trim() : undefined
}

function extractFirstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = html.match(pattern)
    if (m?.[1]) return m[1]
  }
  return undefined
}

function extractDivById(html: string, id: string): string | undefined {
  // 정규식만으로 중첩 <div>를 안전하게 처리하기 어려워,
  // 시작 태그를 찾고 <div>/<\div> 카운팅으로 닫힘을 찾는다.
  const startRe = new RegExp(`<div\\b[^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i")
  const startMatch = html.match(startRe)
  if (!startMatch || startMatch.index == null) return undefined

  const startIndex = startMatch.index
  const afterStart = startIndex + startMatch[0].length

  const tagRe = /<\/div\s*>|<div\b[^>]*>/gi
  tagRe.lastIndex = afterStart

  let depth = 1
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0].toLowerCase()
    if (tag.startsWith("</div")) {
      depth -= 1
      if (depth === 0) {
        const endIndex = m.index + m[0].length
        return html.slice(startIndex, endIndex)
      }
    } else {
      depth += 1
    }
  }

  return undefined
}

// 네이버 기사 상세 크롤링
// Input: sourceUrl(개별 기사 URL)
// Output: 이미지/요약/본문/작성자/발행시각 보강 데이터
async function fetchNaverArticleDetails(sourceUrl: string): Promise<{
  imageUrl?: string
  description?: string
  content?: string
  author?: string
  publishedAt?: Date
}> {
  const html = await fetchHtml(sourceUrl, 9000)
  if (!html) return {}

  const baseUrl = (() => {
    try {
      return new URL(sourceUrl)
    } catch {
      return null
    }
  })()

  const resolveUrl = (value?: string) => {
    if (!value) return undefined
    if (value.startsWith("http://") || value.startsWith("https://")) return value
    if (!baseUrl) return value
    try {
      return new URL(value, baseUrl.origin).href
    } catch {
      return value
    }
  }

  const imageUrl =
    resolveUrl(extractMetaContent(html, "og:image")) ??
    resolveUrl(extractMetaContent(html, "twitter:image"))

  const publishedTimeRaw =
    extractMetaContent(html, "article:published_time") ??
    extractMetaContent(html, "og:article:published_time") ??
    extractMetaContent(html, "og:published_time")
  const publishedAt = publishedTimeRaw ? new Date(publishedTimeRaw) : undefined

  const author =
    extractMetaContent(html, "author") ??
    extractMetaContent(html, "dable:author")

  // 본문: 네이버 뉴스 기사 페이지에서 흔히 쓰는 컨테이너 우선 탐색
  const bodyContainerHtml =
    extractDivById(html, "dic_area") ??
    extractDivById(html, "articeBody") ??
    extractFirstMatch(html, [
      // 마지막 fallback은 class 기반이므로, 여기서는 "중첩 div를 어느 정도 포함"하도록 greedy에 가깝게 잡되,
      // 너무 크게 잡지 않도록 종료 힌트를 둔다.
      /<div[^>]+class=["'][^"']*newsct_article[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
      /<div[^>]+class=["'][^"']*newsct_article[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*\/\/\s*newsct_article\s*-->/i,
      /<div[^>]+class=["'][^"']*newsct_article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ])

  const content = stripHtmlTags(bodyContainerHtml, true)

  const description =
    stripHtmlTags(extractMetaContent(html, "og:description"), false) ??
    stripHtmlTags(extractMetaContent(html, "description"), false) ??
    (content ? content.split("\n").join(" ").slice(0, 180) : undefined)

  return {
    imageUrl,
    description,
    content,
    author,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
  }
}

// 병렬 map 유틸
// Input: items, 동시성 수, mapper 함수
// Output: 입력 순서를 유지한 결과 배열
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await mapper(items[current], current)
    }
  })

  await Promise.all(workers)
  return results
}

// 한국어 시각 문자열 파서
// Input: "2026.03.18. 오전 10:20" 형태의 문자열
// Output: UTC Date 객체(파싱 실패 시 null)
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

// 네이버 리스트/본문 문맥에서 발행시각 추출
// Input: 앵커 주변 HTML 조각
// Output: 파싱된 Date 또는 null
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
// 섹션 HTML에서 기사 목록 파싱
// Input: 네이버 섹션 HTML, 카테고리 코드
// Output: 우선순위 계산 전 기사 배열
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
// 섹션별 수집 + 상세 보강 파이프라인
// Input: categories, limitPerCategory
// Output: 우선순위가 계산된 기사 배열
async function fetchNewsFromNaverHtml(options: {
  categories: NewsCategory[]
  limitPerCategory?: number
}): Promise<NormalizedArticle[]> {
  const limitPerCategory = options.limitPerCategory ?? 20
  const aggregated: NormalizedArticle[] = []

  const fetchAndEnrich = async (sectionUrl: string, baseCategory: NewsCategory) => {
    const html = await fetchNaverSectionHtml(sectionUrl)
    if (!html) return

    const baseArticles = parseNaverNewsHtml(html, baseCategory).slice(0, limitPerCategory)
    const enriched = await mapWithConcurrency(baseArticles, 4, async (base, idx) => {
      const details = base.sourceUrl ? await fetchNaverArticleDetails(base.sourceUrl) : {}
      if (idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      const merged: Omit<NormalizedArticle, "priority"> = {
        ...base,
        imageUrl: details.imageUrl ?? base.imageUrl,
        description: details.description ?? base.description,
        content: details.content ?? base.content,
        author: details.author ?? base.author,
        publishedAt: details.publishedAt ?? base.publishedAt,
      }

      return {
        ...merged,
        category: baseCategory,
        priority: calculatePriority({ ...merged, category: baseCategory }),
      }
    })

    aggregated.push(...enriched)
  }

  for (let i = 0; i < options.categories.length; i++) {
    const category = options.categories[i]
    const sectionUrl = NAVER_SECTION_URLS[category]
    if (!sectionUrl) continue

    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 700))
    }

    await fetchAndEnrich(sectionUrl, category)
  }

  return aggregated
}

// DB 저장 단계
// Input: 정규화된 기사 배열
// Output: fetched/persisted/skipped 집계 결과
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
  console.warn("⚠️  fetchNewsFromAPI는 더 이상 사용되지 않습니다. 네이버 HTML 크롤러를 사용하세요.")
  return []
}

// 최신 뉴스 수집 진입점
// Input: 수집 카테고리/카테고리당 최대 수량
// Output: 저장 결과 집계
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

// 목록 조회 API용 서비스
// Input: 페이징/검색/정렬/카테고리 필터 쿼리
// Output: 뉴스 배열 + pagination 메타데이터
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

// 단건 상세 조회
// Input: newsId
// Output: 해당 뉴스(없거나 오류 시 null)
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

// 검색 래퍼
// Input: query, page, limit
// Output: getNews와 동일한 목록/페이지네이션 구조
export async function searchNews(query: string, page = 1, limit = 10) {
  return getNews({ search: query, page, limit })
}
