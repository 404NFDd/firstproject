import Parser from "rss-parser"
import type { CollectionReport } from "@/lib/collection-report"
import type { TechCategory } from "@/lib/news-categories"
import { TECH_FEED_SOURCES, type TechFeedSource } from "@/lib/feed-sources"
import { getSafeNewsUrl } from "@/lib/news-links"
import { decodeHtmlEntities } from "@/lib/text"
import { feedContentText, sourceContentText, supportsArticleContent } from "@/lib/feed-content"

export interface FeedArticle {
  title: string
  description?: string
  content?: string
  sourceUrl: string
  source: string
  author?: string
  publishedAt: Date
  category: TechCategory
}

interface FeedItem {
  author?: string
  date?: string
  "content:encoded"?: string
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_ATTEMPTS = 3
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

// 시간대가 명시된 피드 날짜만 사용합니다. 현재 시각이나 피드 전체의 갱신 시각을 합성하지 않습니다.
function parsePublishedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i)
  const rfc = text.match(/^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+\d{2}:\d{2}(?::\d{2})?\s+(?:UT|UTC|GMT|[ECMP][DS]T|[+-]\d{4})$/i)
  if (!iso && !rfc) return null

  const year = Number(iso ? iso[1] : rfc![3])
  const month = iso ? Number(iso[2]) : MONTHS.indexOf(rfc![2].toLowerCase()) + 1
  const day = Number(iso ? iso[3] : rfc![1])
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null

  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return ""
  const text = value
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:a|abbr|article|aside|b|blockquote|br|code|dd|del|div|dl|dt|em|figcaption|figure|h[1-6]|hr|i|img|li|main|ol|p|pre|section|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|ul|video)\b[^>]*>/gi, " ")
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim()
}

function articleUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const safeUrl = getSafeNewsUrl(decodeHtmlEntities(value))
  if (!safeUrl) return null
  const url = new URL(safeUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid)$/i.test(key)) {
      url.searchParams.delete(key)
    }
  }
  return url.href
}

class FeedResponseError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
  }
}

async function readFeedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"))
  if (contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new FeedResponseError("피드 응답 크기 제한을 초과했습니다.")
  }
  if (!response.body) throw new FeedResponseError("피드 응답이 비어 있습니다.")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new FeedResponseError("피드 응답 크기 제한을 초과했습니다.")
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function fetchFeedText(url: string, article = false, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    signal?.throwIfAborted()
    try {
      const response = await fetch(url, {
        headers: { Accept: article ? "text/html" : "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" },
        redirect: article ? "error" : "follow",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new FeedResponseError(
          "피드 HTTP 오류: " + response.status,
          response.status === 429 || response.status >= 500
        )
      }
      return await readFeedText(response)
    } catch (error) {
      signal?.throwIfAborted()
      if ((error instanceof FeedResponseError && !error.retryable) || attempt === MAX_ATTEMPTS - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
    }
  }
  throw new Error("피드를 가져올 수 없습니다.")
}

export async function fetchArticleContent(sourceId: string, sourceUrl: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!supportsArticleContent(sourceId, sourceUrl)) return undefined
  return sourceContentText(sourceId, await fetchFeedText(sourceUrl, true, signal))
}

async function fetchSource(source: TechFeedSource, limit: number, report: CollectionReport, signal?: AbortSignal): Promise<FeedArticle[]> {
  const xml = await fetchFeedText(source.url, false, signal)
  // CDATA의 기사 HTML과 XML 주석 안의 문자는 XML DTD 선언이 아닙니다.
  const declarations = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "")
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(declarations)) throw new Error("피드의 DTD 선언은 허용하지 않습니다.")

  const parser = new Parser<Record<string, unknown>, FeedItem>({
    customFields: { item: ["author", "date", "content:encoded"] },
    xml2js: {
      // href 없는 Atom link 하나가 파서 전체를 중단하지 않도록 해당 링크만 무효 처리합니다.
      validator: (path: string, _previous: unknown, value: unknown) =>
        /^\/feed\/(?:entry\/)?link$/.test(path) &&
        (!value || typeof value !== "object" || !("$" in value)) ? { $: {} } : value,

      // Atom 날짜 하나가 잘못되어도 rss-parser의 날짜 변환이 전체 피드를 중단하지 않게 합니다.
      valueProcessors: [(value: string, name: string) =>
        /^(?:published|updated|pubDate|dc:date|date)$/.test(name) && !parsePublishedAt(value) ? "" : value],
    },
  })
  const feed = await parser.parseString(xml)
  const isAtom = /<feed[\s>]/i.test(declarations)
  const articles = new Map<string, FeedArticle>()

  report.received = feed.items.length
  for (const item of feed.items) {
    const title = plainText(item.title)
    const sourceUrl = articleUrl(item.link)
    const publishedAt = [item.pubDate, item.date, item.isoDate].map(parsePublishedAt).find(Boolean)
    if (!title || !sourceUrl || !publishedAt) {
      const reason = !title ? "invalid_title" : !sourceUrl ? "invalid_url" : "invalid_date"
      report.reasons[reason] = (report.reasons[reason] || 0) + 1
      report.excluded++
      continue
    }

    // PostgreSQL News의 RSS description은 요약이 아닌 전체 공지 본문입니다.
    const content = feedContentText(item["content:encoded"] || (isAtom || source.id === "postgresql" ? item.content : undefined))
    // 일부 Laravel 릴리스는 version, Changes 등 단어 하나만 제공하므로 건너뜁니다.
    if (source.id === "laravel" && /^(?:changes|version|what[’']s changed)$/i.test(content?.trim() ?? "")) {
      report.excluded++
      report.missingContent++
      report.reasons.missing_content = (report.reasons.missing_content || 0) + 1
      continue
    }
    const description = plainText(item.summary || (!isAtom ? item.content : undefined) || content).slice(0, 2000) || undefined
    const author = plainText(item.creator || item.author).slice(0, 191) || undefined
    const article: FeedArticle = { title, description, content, sourceUrl, source: source.name, author, publishedAt, category: source.category }
    const existing = articles.get(sourceUrl)
    if (existing) { report.excluded++; report.reasons.duplicate_url = (report.reasons.duplicate_url || 0) + 1 }
    if (!existing || article.publishedAt > existing.publishedAt) articles.set(sourceUrl, article)
  }

  const latest = [...articles.values()].sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime()).slice(0, limit)
  report.limited = Math.max(0, articles.size - latest.length)
  // 전체 피드 이력을 요청하지 않고 이번 수집 범위의 빈 본문만 보강합니다.
  for (const article of latest) {
    if (article.content) continue
    try {
      article.content = await fetchArticleContent(source.id, article.sourceUrl, signal)
    } catch {
      console.warn("기사 본문을 가져오지 못했습니다:", source.id)
    }
  }
  const accepted = latest.filter((article) => article.content?.trim())
  const missingContent = latest.length - accepted.length
  report.missingContent += missingContent
  report.excluded += missingContent
  if (report.missingContent) report.reasons.missing_content = report.missingContent
  if (signal?.aborted) report.error = "수집 시간 제한을 초과했습니다."
  return accepted
}

export async function fetchTechFeeds(
  options: { categories?: TechCategory[]; limitPerSource?: number; signal?: AbortSignal } = {}
): Promise<{ articles: FeedArticle[]; failedSources: string[]; sourceReports: CollectionReport[] }> {
  const limit = options.limitPerSource ?? 10
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("소스별 수집 수는 1~50의 정수여야 합니다.")
  const sources = TECH_FEED_SOURCES.filter((source) => !options.categories || options.categories.includes(source.category))
  const allArticles: FeedArticle[] = []
  const failedSources: string[] = []
  const sourceReports: CollectionReport[] = []

  for (let offset = 0; offset < sources.length; offset += 3) {
    const results = await Promise.all(sources.slice(offset, offset + 3).map(async (source) => {
      const started = Date.now()
      const report: CollectionReport = {
        id: source.id, name: source.name, status: "success", received: 0, accepted: 0,
        excluded: 0, limited: 0, missingContent: 0, reasons: {}, durationMs: 0,
      }
      const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(60_000)])
      let articles: FeedArticle[] = []
      try {
        articles = await fetchSource(source, limit, report, signal)
      } catch (error) {
        report.error = signal.aborted ? "수집 시간 제한을 초과했습니다." : "피드 요청 또는 해석에 실패했습니다."
        report.reasons[signal.aborted ? "timeout" : "source_error"] = 1
        console.warn("피드 수집에 실패했습니다:", source.id, error instanceof Error ? error.message.slice(0, 300) : "알 수 없는 오류")
      }
      report.accepted = articles.length
      report.durationMs = Date.now() - started
      report.status = !articles.length ? "failed" : report.excluded || report.error ? "partial" : "success"
      return { source, articles, report }
    }))
    for (const { source, articles, report } of results) {
      if (!articles.length || report.error) failedSources.push(source.id)
      allArticles.push(...articles)
      sourceReports.push(report)
    }
  }

  const articles = new Map<string, FeedArticle>()
  for (const article of allArticles.sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())) {
    if (!articles.has(article.sourceUrl)) articles.set(article.sourceUrl, article)
  }
  return { articles: [...articles.values()], failedSources, sourceReports }
}
