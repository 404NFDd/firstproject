import type { CollectionReport } from "@/lib/collection-report"
import { getListSummaries, enqueueArticleSummary, PUBLISHED_SUMMARY_FILTER } from "@/lib/news-summary-service"
import { CURATION_KIND } from "@/lib/news-curation"
import { NEWS_SYNC_TIMEOUT_MS, NEWS_SYNC_PERSIST_TIMEOUT_MS } from "@/lib/news-sync"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { newsQuerySchema, newsSyncSchema } from "@/lib/news-validation"
import { decodeHtmlEntities } from "@/lib/text"
import { fetchSpecialNews, fetchSpecialSummaryContent } from "@/lib/naver-special-news"
import { fetchTechFeeds, fetchFeedSummaryContent } from "@/lib/feed-news"
import { TECH_FEED_SOURCES, EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import { TECH_NEWS_CATEGORY_VALUES, getNewsCategoryLabel } from "@/lib/news-categories"

const NAVER_NEWS_CATEGORIES = [
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

type NaverNewsCategory = (typeof NAVER_NEWS_CATEGORIES)[number]
type TechNewsCategory = (typeof TECH_NEWS_CATEGORY_VALUES)[number]
export const SUPPORTED_NEWS_CATEGORIES = [...NAVER_NEWS_CATEGORIES, ...TECH_NEWS_CATEGORY_VALUES] as const
type NewsCategory = (typeof SUPPORTED_NEWS_CATEGORIES)[number]

// 네이버 뉴스 섹션 URL 매핑 (HTML 크롤링용)
const NAVER_SECTION_URLS: Partial<Record<NaverNewsCategory, string>> = {
  "100": "https://news.naver.com/section/100",
  "101": "https://news.naver.com/section/101",
  "102": "https://news.naver.com/section/102",
  "103": "https://news.naver.com/section/103",
  "104": "https://news.naver.com/section/104",
  "105": "https://news.naver.com/section/105",
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
  developer: 8,
  engineering: 8,
  ai: 8,
  infrastructure: 8,
  release: 8,
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
  failedCategories: NaverNewsCategory[]
  failedSources: string[]
  createdCount: number
  repairedCount: number
  excludedCount: number
  durationMs: number
  sourceReports: CollectionReport[]
}

export class NewsCollectionError extends Error {
  constructor(message: string, readonly result: NewsIngestResult) { super(message) }
}

const sanitizeString = (value?: string | null) => value?.trim() || undefined

function normalizeArticleUrl(href: string): string | undefined {
  try {
    const url = new URL(decodeHtmlEntities(href), "https://news.naver.com")
    if (url.protocol !== "https:") return undefined
    if (["news.naver.com", "n.news.naver.com"].includes(url.hostname)) {
      const ids = url.pathname.match(/^\/(?:mnews\/)?article\/(\d+)\/(\d+)\/?$/)
      const legacy = /^\/main\/read\.(?:naver|nhn)$/.test(url.pathname)
      const oid = ids?.[1] ?? (legacy ? url.searchParams.get("oid") : null)
      const aid = ids?.[2] ?? (legacy ? url.searchParams.get("aid") : null)
      if (!oid || !aid || !/^\d+$/.test(oid) || !/^\d+$/.test(aid)) return undefined
      return `https://n.news.naver.com/mnews/article/${oid}/${aid}`
    }
    if (["m.entertain.naver.com", "m.sports.naver.com"].includes(url.hostname) && /^\/article\/\d+\/\d+\/?$/.test(url.pathname)) {
      url.search = ""
      url.hash = ""
      return url.href
    }
  } catch { /* 올바르지 않은 기사 링크는 제외한다. */ }
  return undefined
}


// HTML 태그 제거 및 텍스트만 추출 (개행 보존 옵션)
// HTML 정리 유틸
// Input: HTML 문자열, preserveNewlines(개행 보존 여부)
// Output: 태그/엔티티가 정리된 평문 문자열
const stripHtmlTags = (html?: string | null, preserveNewlines = false): string | undefined => {
  if (!html) return undefined

  let text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")

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

  text = decodeHtmlEntities(text)

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
// Output: 원문 URL(없으면 제목·출처) 기준으로 dedupe된 배열
const dedupeArticles = (articles: NormalizedArticle[]): NormalizedArticle[] => {
  const seen = new Map<string, NormalizedArticle>()
  for (const article of articles) {
    const key = article.sourceUrl ?? JSON.stringify([article.title, article.source])
    if (!seen.has(key)) {
      seen.set(key, article)
    }
  }
  return Array.from(seen.values())
}

async function fetchHtml(url: string, timeoutMs = 8000, signal?: AbortSignal): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted()
    try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      await response.body?.cancel()
      if (response.status !== 429 && response.status < 500) return null
      if (attempt === 2) return null
      console.warn(`[news-fetch] ${new URL(url).host} HTTP ${response.status}, 재시도 ${attempt + 1}/2`)
    } else {
      return await response.text()
    }
    } catch {
      signal?.throwIfAborted()
      if (attempt === 2) return null
      console.warn(`[news-fetch] ${new URL(url).host} 네트워크 오류, 재시도 ${attempt + 1}/2`)
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt))
  }
  return null
}

// 네이버 섹션 HTML 요청 래퍼
async function fetchNaverSectionHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  const html = await fetchHtml(url, 8000, signal)
  if (!html) {
    console.warn(`⚠️  네이버 뉴스 HTML 요청 실패 (${url})`)
  }
  return html
}

function extractMetaContent(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) ?? []
  for (const tag of tags) {
    const name = tag.match(/\s(?:property|name)\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (name?.toLowerCase() !== key.toLowerCase()) continue
    const content = tag.match(/\scontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    return content?.trim() || undefined
  }
  return undefined
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
async function fetchNaverArticleDetails(sourceUrl: string, signal?: AbortSignal, metadataOnly = false): Promise<{
  imageUrl?: string
  description?: string
  content?: string
  author?: string
  publishedAt?: Date
  failed: boolean
}> {
  const html = await fetchHtml(sourceUrl, 9000, signal)
  if (!html) return { failed: true }

  const baseUrl = (() => {
    try {
      return new URL(sourceUrl)
    } catch {
      return null
    }
  })()

  const resolveUrl = (value?: string) => {
    if (!value) return undefined
    try {
      const url = new URL(decodeHtmlEntities(value), baseUrl?.href)
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
    } catch {
      return undefined
    }
  }

  const imageUrl =
    resolveUrl(extractMetaContent(html, "og:image")) ??
    resolveUrl(extractMetaContent(html, "twitter:image"))

  const publishedTimeRaw =
    extractMetaContent(html, "article:published_time") ??
    extractMetaContent(html, "og:article:published_time") ??
    extractMetaContent(html, "og:published_time")
  const publishedAt = (publishedTimeRaw ? parseNaverPublishedAt(`<time datetime="${publishedTimeRaw.replace(" ", "T")}"></time>`) : null) ?? parseNaverPublishedAt(html)

  const author = stripHtmlTags(
    extractMetaContent(html, "author") ?? extractMetaContent(html, "dable:author"),
  )

  if (metadataOnly) return { imageUrl, author, publishedAt: publishedAt || undefined, failed: false }

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

  const metaDescription = extractMetaContent(html, "og:description") ?? extractMetaContent(html, "description")
  const description =
    sanitizeString(decodeHtmlEntities(metaDescription).replace(/\s+/g, " ")) ??
    (content ? content.split("\n").join(" ").slice(0, 180) : undefined)

  return {
    imageUrl,
    description,
    content,
    author,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    failed: !content,
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

// 발행시각은 한국 시각으로 읽으며 잘못된 날짜의 자동 보정은 허용하지 않는다.
function koreanDate(year: number, month: number, day: number, hour: number, minute: number, second: number): Date | null {
  if (year < 100 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null
  return new Date(local.getTime() - 9 * 60 * 60 * 1000)
}

function parseNaverPublishedAt(contextHtml: string): Date | null {
  const attribute = contextHtml.match(/(?:data-date-time|datetime)=["'](\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)["']/i)
  if (attribute) {
    const raw = attribute[1].replace(" ", "T")
    const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
    if (parts && koreanDate(Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]), Number(parts[5]), Number(parts[6] ?? 0))) {
      const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}+09:00`)
      if (!Number.isNaN(date.getTime())) return date
    }
  }
  const visible = contextHtml.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\.\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!visible) return null
  let hour = Number(visible[5])
  if (visible[4]) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (visible[4] === "오후" ? 12 : 0)
  }
  return koreanDate(Number(visible[1]), Number(visible[2]), Number(visible[3]), hour, Number(visible[6]), Number(visible[7] ?? 0))
}

// 네이버 뉴스 HTML에서 기사 정보 추출
// 섹션 HTML에서 기사 목록 파싱
// Input: 네이버 섹션 HTML, 카테고리 코드
// Output: 우선순위 계산 전 기사 배열
function parseNaverNewsHtml(html: string, category: NaverNewsCategory): Array<Omit<NormalizedArticle, "priority" | "publishedAt"> & { publishedAt?: Date }> {
  const articles: Array<Omit<NormalizedArticle, "priority" | "publishedAt"> & { publishedAt?: Date }> = []

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

    const sourceUrl = normalizeArticleUrl(href)
    if (!sourceUrl) continue

    // 다른 기사의 날짜가 섞이지 않도록 해당 목록 항목 안에서만 읽는다.
    const itemStart = html.lastIndexOf("<li", match.index)
    const previousItemEnd = html.lastIndexOf("</li>", match.index)
    const itemEnd = html.indexOf("</li>", anchorPattern.lastIndex)
    const contextHtml = itemStart > previousItemEnd && itemEnd >= 0
      ? html.slice(itemStart, itemEnd + 5) : match[0]
    const source = stripHtmlTags(extractFirstMatch(contextHtml, [/<div[^>]+class=["'][^"']*sa_text_press[^"']*["'][^>]*>([\s\S]*?)<\/div>/i])) ?? "네이버 뉴스"

    // 목록에서 확인하지 못한 발행시각은 상세 원문에서 다시 확인한다.
    const publishedAt = parseNaverPublishedAt(contextHtml) ?? undefined

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
  categories: NaverNewsCategory[]
  limitPerCategory?: number
  signal?: AbortSignal
}): Promise<{ articles: NormalizedArticle[]; failedCategories: NaverNewsCategory[]; sourceReports: CollectionReport[] }> {
  const limitPerCategory = options.limitPerCategory ?? 20
  const aggregated: NormalizedArticle[] = []
  const failedCategories: NaverNewsCategory[] = []
  const sourceReports: CollectionReport[] = []
  const detailsCache = new Map<string, ReturnType<typeof fetchNaverArticleDetails>>()

  const fetchAndEnrich = async (sectionUrl: string, baseCategory: NaverNewsCategory, report: CollectionReport) => {
    const html = await fetchNaverSectionHtml(sectionUrl, options.signal)
    if (!html) {
      failedCategories.push(baseCategory)
      report.error = "목록 응답을 읽을 수 없습니다."
      report.reasons.source_error = 1
      return
    }

    const seenUrls = new Set<string>()
    const parsed = parseNaverNewsHtml(html, baseCategory)
    report.received = parsed.length
    const unique = parsed.filter((article) => {
      if (seenUrls.has(article.sourceUrl!)) {
        report.excluded++
        report.reasons.duplicate_url = (report.reasons.duplicate_url || 0) + 1
        return false
      }
      seenUrls.add(article.sourceUrl!)
      return true
    })
    const baseArticles = unique.slice(0, limitPerCategory)
    report.limited = unique.length - baseArticles.length
    if (baseArticles.length === 0) failedCategories.push(baseCategory)
    const enriched = await mapWithConcurrency(baseArticles, 4, async (base, idx) => {
      const url = base.sourceUrl!
      if (!detailsCache.has(url)) detailsCache.set(url, fetchNaverArticleDetails(url, options.signal, true))
      const details = await detailsCache.get(url)!.catch((): Awaited<ReturnType<typeof fetchNaverArticleDetails>> => ({ failed: true }))
      if (details.failed && !failedCategories.includes(baseCategory)) failedCategories.push(baseCategory)
      if (idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      const publishedAt = details.publishedAt ?? base.publishedAt
      if (!publishedAt) {
        report.excluded++
        report.reasons.invalid_date = (report.reasons.invalid_date || 0) + 1
        if (!failedCategories.includes(baseCategory)) failedCategories.push(baseCategory)
        return null
      }

      const merged: Omit<NormalizedArticle, "priority"> = {
        ...base,
        imageUrl: details.imageUrl ?? base.imageUrl,
        description: details.description ?? base.description,
        content: details.content ?? base.content,
        author: details.author ?? base.author,
        publishedAt,
      }

      return {
        ...merged,
        category: baseCategory,
        priority: calculatePriority({ ...merged, category: baseCategory }),
      }
    })

    aggregated.push(...enriched.filter((article) => article !== null))
  }

  for (let i = 0; i < options.categories.length; i++) {
    const category = options.categories[i]
    const started = Date.now()
    const previousCount = aggregated.length
    const report: CollectionReport = {
      id: "naver-" + category, name: "네이버 " + getNewsCategoryLabel(category), status: "success", received: 0,
      accepted: 0, excluded: 0, limited: 0, missingContent: 0, reasons: {}, durationMs: 0,
    }
    try {
      options.signal?.throwIfAborted()
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 700))
      if (category === "106" || category === "107") {
        const result = await fetchSpecialNews(category, limitPerCategory, options.signal, true)
        report.received = result.received
        report.excluded = result.excluded
        report.limited = result.limited
        report.reasons = result.reasons
        if (result.partial || !result.articles.length) failedCategories.push(category)
        aggregated.push(...result.articles.map((article) => ({ ...article, priority: calculatePriority(article) })))
      } else {
        const sectionUrl = NAVER_SECTION_URLS[category]
        if (sectionUrl) await fetchAndEnrich(sectionUrl, category, report)
      }
    } catch {
      if (!failedCategories.includes(category)) failedCategories.push(category)
      report.error = options.signal?.aborted ? "수집 시간 제한을 초과했습니다." : "목록 또는 본문 수집에 실패했습니다."
      report.reasons[options.signal?.aborted ? "timeout" : "source_error"] = 1
    }
    if (options.signal?.aborted) {
      if (!failedCategories.includes(category)) failedCategories.push(category)
      report.error = "수집 시간 제한을 초과했습니다."
      report.reasons.timeout = 1
    }
    report.accepted = aggregated.length - previousCount
    report.status = !report.accepted ? "failed" : failedCategories.includes(category) || report.excluded ? "partial" : "success"
    report.durationMs = Date.now() - started
    sourceReports.push(report)
  }
  return { articles: aggregated, failedCategories, sourceReports }
}

// DB 저장 단계
// Input: 정규화된 기사 배열
// Output: fetched/persisted/skipped 집계 결과
async function persistArticles(articles: NormalizedArticle[], counts: { fetched: number; persisted: number; skipped: number; createdCount: number; repairedCount: number }, signal: AbortSignal) {

  for (const article of articles) {
    signal.throwIfAborted()
    const identity: Prisma.NewsWhereInput = article.sourceUrl
      ? { sourceUrl: article.sourceUrl } : { title: article.title, source: article.source }
    const existing = await prisma.news.findFirst({
      where: identity,
      select: { id: true, title: true, source: true, sourceUrl: true, category: true },
    })

    if (existing) {
      counts.skipped++
      await enqueueArticleSummary({ id: existing.id, title: existing.title || article.title,
        source: existing.source || article.source, sourceUrl: existing.sourceUrl,
        category: existing.category || article.category })
      continue
    }

    const created = await prisma.news.create({
      data: {
        title: article.title,
        description: null,
        content: null,
        imageUrl: article.imageUrl,
        sourceUrl: article.sourceUrl,
        source: article.source,
        author: article.author,
        publishedAt: article.publishedAt,
        category: article.category,
        priority: article.priority,
      },
    })
    counts.persisted++
    counts.createdCount++
    await enqueueArticleSummary({ ...article, id: created.id, description: null, content: null })
  }

  return counts
}

export async function fetchArticleSummaryContent(article: { source: string; sourceUrl?: string | null }) {
  if (!article.sourceUrl) throw new Error("요약할 원문 링크가 없습니다.")
  const signal = AbortSignal.timeout(30_000)
  const source = TECH_FEED_SOURCES.find((source) => source.name === article.source)
  if (source) return fetchFeedSummaryContent(source, article.sourceUrl, signal)
  const url = normalizeArticleUrl(article.sourceUrl)
  if (!url) throw new Error("요약을 지원하지 않는 원문 출처입니다.")
  if (new URL(url).hostname === "n.news.naver.com") return (await fetchNaverArticleDetails(url, signal)).content
  return fetchSpecialSummaryContent(url, signal)
}

// 최신 뉴스 수집 진입점
// Input: 수집 카테고리/카테고리당 최대 수량
// Output: 저장 결과 집계
export async function ingestLatestNews(options?: {
  scope?: "tech" | "all"
  categories?: NewsCategory[]
  limitPerCategory?: number
}, signal = AbortSignal.timeout(NEWS_SYNC_TIMEOUT_MS)): Promise<NewsIngestResult> {
  const started = Date.now()
  const validated = newsSyncSchema.parse(options ?? {})
  const categories = [...new Set(validated.categories ?? (validated.scope === "all"
    ? SUPPORTED_NEWS_CATEGORIES : ["105", ...TECH_NEWS_CATEGORY_VALUES]))]
  const limitPerCategory = validated.limitPerCategory ?? 20
  const naverCategories = categories.filter((category): category is NaverNewsCategory => NAVER_NEWS_CATEGORIES.includes(category as NaverNewsCategory))
  const techCategories = categories.filter((category): category is TechNewsCategory => TECH_NEWS_CATEGORY_VALUES.includes(category as TechNewsCategory))

  // 각 수집기를 격리해 한쪽이 실패해도 다른 소스에서 확인한 기사는 저장합니다.
  // 기술 피드는 카테고리별 제한값을 각 소스의 최대 항목 수로 사용합니다.
  const [naver, feeds] = await Promise.allSettled([
    fetchNewsFromNaverHtml({ categories: naverCategories, limitPerCategory, signal }),
    techCategories.length ? fetchTechFeeds({ categories: techCategories, limitPerSource: limitPerCategory, signal, metadataOnly: true })
      : Promise.resolve({ articles: [], failedSources: [], sourceReports: [] }),
  ])
  const naverArticles = naver.status === "fulfilled" ? naver.value.articles : []
  const failedCategories = naver.status === "fulfilled" ? naver.value.failedCategories : naverCategories
  const feedArticles = feeds.status === "fulfilled" ? feeds.value.articles : []
  const failedSources = feeds.status === "fulfilled" ? feeds.value.failedSources
    : TECH_FEED_SOURCES.filter((source) => techCategories.includes(source.category)).map((source) => source.id)
  if (naver.status === "rejected") console.warn("네이버 수집기 실패:", naver.reason)
  if (feeds.status === "rejected") console.warn("기술 피드 수집기 실패:", feeds.reason)

  const sourceReports = [
    ...(naver.status === "fulfilled" ? naver.value.sourceReports : []),
    ...(feeds.status === "fulfilled" ? feeds.value.sourceReports : []),
  ]
  const articles = dedupeArticles([...naverArticles, ...feedArticles.map((article) => ({ ...article, priority: calculatePriority(article) }))])
  const counts = { fetched: articles.length, persisted: 0, skipped: 0, createdCount: 0, repairedCount: 0 }
  const result = (): NewsIngestResult => ({
    ...counts, failedCategories, failedSources, sourceReports,
    excludedCount: sourceReports.reduce((sum, report) => sum + report.excluded, 0),
    durationMs: Date.now() - started,
  })
  if (!articles.length) {
    throw new NewsCollectionError(`수집된 뉴스가 없습니다. 뉴스 소스와 피드 응답을 확인해주세요. 카테고리: ${failedCategories.join(", ")}; 소스: ${failedSources.join(", ")}`, result())
  }
  // 느린 출처가 전체 수집 제한에 걸려도 이미 확인한 다른 출처 기사는 저장합니다.
  // 요청의 5분 실행 한도 안에서 저장 단계에 최대 30초의 여유를 남깁니다.
  const persistenceSignal = AbortSignal.timeout(Math.max(1, started + NEWS_SYNC_TIMEOUT_MS + NEWS_SYNC_PERSIST_TIMEOUT_MS - Date.now()))
  try {
    await persistArticles(articles, counts, persistenceSignal)
  } catch {
    const unprocessed = articles.length - counts.persisted - counts.skipped
    sourceReports.push({
      id: "persistence", name: "기사 저장", status: "failed", received: articles.length,
      accepted: counts.persisted + counts.skipped, excluded: unprocessed, limited: 0,
      missingContent: 0, reasons: { [persistenceSignal.aborted ? "timeout" : "database_error"]: unprocessed },
      durationMs: Date.now() - started, error: persistenceSignal.aborted ? "저장 시간 제한을 초과했습니다." : "기사 저장에 실패했습니다.",
    })
    throw new NewsCollectionError("수집한 기사를 저장하는 중 오류가 발생했습니다.", result())
  }
  return result()
}

// 목록 조회 API용 서비스
// Input: 페이징/검색/정렬/카테고리 필터 쿼리
// Output: 뉴스 배열 + pagination 메타데이터
export async function getNews(query: NewsQuery = {}) {
  try {
    const { page, limit, sort, category, search, minPriority } = newsQuerySchema.parse(query)
    const skip = (page - 1) * limit

    const where: Prisma.NewsWhereInput = { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, ...PUBLISHED_SUMMARY_FILTER }
    if (category === "tech") {
      where.category = { in: ["105", ...TECH_NEWS_CATEGORY_VALUES] }
    } else if (category && category !== "all") {
      where.category = category
    }
    if (search) {
      // 현재 스키마는 MySQL이며 검색의 대소문자 구분은 DB collation을 따른다.
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { translations: { some: { kind: CURATION_KIND, status: "ready", OR: [
          { translatedTitle: { contains: search } }, { translatedText: { contains: search } },
        ] } } },
      ]
    }
    if (typeof minPriority === "number") {
      where.priority = { gte: minPriority }
    }

    const orderBy: Prisma.NewsOrderByWithRelationInput[] = []
    if (sort === "priority") {
      orderBy.push({ priority: "desc" })
    } else if (sort === "popular") {
      orderBy.push({ readHistory: { _count: "desc" } })
    }
    orderBy.push({ publishedAt: "desc" })
    orderBy.push({ id: "desc" })

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: { id: true, title: true, imageUrl: true, sourceUrl: true,
          source: true, author: true, publishedAt: true, category: true, priority: true },
      }),
      prisma.news.count({ where }),
    ])

    const summaries = await getListSummaries(news)
    const cards = news.map((article) => {
      const summary = summaries.get(article.id)
      return {
        id: article.id, imageUrl: article.imageUrl, sourceUrl: article.sourceUrl, source: article.source,
        author: article.author, publishedAt: article.publishedAt, category: article.category, priority: article.priority,
        title: summary?.title || article.title,
        preview: summary?.preview || "",
        previewType: summary ? "summary" : "none",
      }
    })
    return {
      news: cards,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error getting news:", error)
    throw error
  }
}

// 단건 상세 조회
// Input: newsId
// Output: 해당 뉴스(없거나 오류 시 null)
export async function getNewsDetail(newsId: string) {
  try {
    const news = await prisma.news.findUnique({
      where: { id: newsId },
      include: {
        readHistory: true,
      },
    })
    if (!news || EXCLUDED_COMMUNITY_SOURCES.includes(news.source)) return null
    const summary = (await getListSummaries([news])).get(news.id)
    if (!summary?.isSummary) return null
    return { ...news, title: summary?.title || news.title, description: summary?.preview || null, content: null }
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
