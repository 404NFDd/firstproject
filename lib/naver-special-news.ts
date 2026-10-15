import { z } from "zod"
import { decodeHtmlEntities } from "@/lib/text"

export interface SpecialArticle {
  title: string
  description?: string
  content?: string
  imageUrl?: string
  sourceUrl: string
  source: string
  author?: string
  publishedAt: Date
  category: string
}

interface ListedArticle extends SpecialArticle {
  oid: string
  aid: string
}

const sportsSections = [
  "kbaseball", "wbaseball", "kfootball", "wfootball",
  "basketball", "volleyball", "golf", "general",
] as const

const listItemSchema = z.object({
  oid: z.string().regex(/^\d{1,20}$/),
  aid: z.string().regex(/^\d{1,20}$/),
  title: z.string().trim().min(1),
  subContent: z.string().optional(),
  image: z.string().optional(),
  thumbnail: z.string().optional(),
  officeName: z.string().optional(),
  sourceName: z.string().optional(),
  articleDateTime: z.string().optional(),
  dateTime: z.string().optional(),
  sportsSection: z.string().regex(/^[a-z0-9-]{1,50}$/).optional(),
})

const listResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({ newsList: z.array(z.unknown()) }),
})

const detailResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    articleInfo: z.object({
      article: z.object({
        officeId: z.string(),
        articleId: z.string(),
        refinedContent: z.string().optional(),
        content: z.string().optional(),
        subcontent: z.string().optional(),
        reporter: z.string().optional(),
        serviceDatetime: z.string().optional(),
      }),
    }),
  }),
})

function plainText(value: string | undefined): string {
  if (!value) return ""
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>|<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#x[\da-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity) => decodeHtmlEntities(entity))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function parseKoreanDate(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(value)) return
  const normalized = value.replace(" ", "T")
  const parsed = new Date(normalized + "+09:00")
  if (Number.isNaN(parsed.getTime())) return
  const roundTrip = new Date(parsed.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19)
  return roundTrip === normalized ? parsed : undefined
}

function imageUrl(value: string | undefined): string | undefined {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return
    if (url.protocol === "http:") url.protocol = "https:"
    return url.toString()
  } catch {
    return
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted()
    let response: Response
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      })
    } catch (error) {
      signal?.throwIfAborted()
      if (attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      continue
    }
    if (response.ok) return response.json()
    await response.body?.cancel()
    if ((response.status !== 429 && response.status < 500) || attempt === 2) {
      throw new Error("네이버 공개 뉴스 API 요청 실패: " + response.status)
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
  }
  throw new Error("네이버 공개 뉴스 API 재시도 실패")
}

/**
 * HTML 대신 공개 목록·본문 API를 사용하는 연예·스포츠 수집 경로입니다.
 * 스포츠는 공식 메뉴의 8개 종목 목록을 합쳐 최신 기사부터 선택합니다.
 */
export async function fetchSpecialSummaryContent(sourceUrl: string, signal?: AbortSignal) {
  const url = new URL(sourceUrl)
  const ids = url.pathname.match(/^\/article\/(\d{1,20})\/(\d{1,20})\/?$/)
  if (url.protocol !== "https:" || url.username || url.password || url.port || !ids ||
    !["m.entertain.naver.com", "m.sports.naver.com"].includes(url.hostname)) return undefined
  const host = url.hostname === "m.entertain.naver.com" ? "api-gw.entertain.naver.com" : "api-gw.sports.naver.com"
  const detail = detailResponseSchema.parse(await fetchJson(`https://${host}/news/article/${ids[1]}/${ids[2]}`, signal)).result.articleInfo.article
  if (detail.officeId !== ids[1] || detail.articleId !== ids[2]) throw new Error("요약할 기사 식별자가 다릅니다.")
  return plainText(detail.refinedContent) || plainText(detail.content) || undefined
}

export async function fetchSpecialNews(
  category: "106" | "107",
  limit: number,
  signal?: AbortSignal,
  metadataOnly = false
): Promise<{ articles: SpecialArticle[]; partial: boolean; received: number; excluded: number; limited: number; reasons: Record<string, number> }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("수집 수량은 1~50 사이의 정수여야 합니다.")
  }
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const sections = category === "106" ? ["entertain"] : [...sportsSections]
  const listed: ListedArticle[] = []
  let partial = false
  let received = 0
  let excluded = 0
  const reasons: Record<string, number> = {}

  for (let offset = 0; offset < sections.length; offset += 3) {
    if (signal?.aborted) { partial = true; break }
    const results = await Promise.allSettled(
      sections.slice(offset, offset + 3).map(async (section) => {
        const url = category === "106"
          ? new URL("https://api-gw.entertain.naver.com/news/articles")
          : new URL("https://api-gw.sports.naver.com/news/articles/" + section)
        url.searchParams.set("date", category === "106" ? today.replace(/-/g, "") : today)
        url.searchParams.set("page", "1")
        url.searchParams.set("pageSize", String(limit))
        if (category === "107") {
          url.searchParams.set("sort", "latest")
          url.searchParams.set("isPhoto", "N")
        }
        const response = listResponseSchema.parse(await fetchJson(url.toString(), signal))
        const articles: ListedArticle[] = []
        let malformed = false
        received += response.result.newsList.length
        for (const value of response.result.newsList) {
          const parsed = listItemSchema.safeParse(value)
          if (!parsed.success) {
            malformed = true
            excluded++
            reasons.invalid_item = (reasons.invalid_item || 0) + 1
            continue
          }
          const item = parsed.data
          const publishedAt = parseKoreanDate(category === "106" ? item.articleDateTime : item.dateTime)
          const title = plainText(item.title)
          const source = plainText(category === "106" ? item.officeName : item.sourceName)
          if (!publishedAt || !title || !source) {
            malformed = true
            excluded++
            const reason = !publishedAt ? "invalid_date" : !title ? "invalid_title" : "invalid_source"
            reasons[reason] = (reasons[reason] || 0) + 1
            continue
          }
          articles.push({
            oid: item.oid,
            aid: item.aid,
            title,
            description: plainText(item.subContent) || undefined,
            imageUrl: imageUrl(item.image) || imageUrl(item.thumbnail),
            sourceUrl: category === "106"
              ? "https://m.entertain.naver.com/now/article/" + item.oid + "/" + item.aid
              : "https://m.sports.naver.com/" + (item.sportsSection || section) + "/article/" + item.oid + "/" + item.aid,
            source,
            category,
            publishedAt,
          })
        }
        return { articles, malformed }
      })
    )
    for (const result of results) {
      if (result.status === "fulfilled") {
        listed.push(...result.value.articles)
        partial ||= result.value.malformed
      } else {
        partial = true
        const reason = signal?.aborted ? "timeout" : "source_error"
        reasons[reason] = (reasons[reason] || 0) + 1
        console.warn("네이버 특수 카테고리 목록 수집 실패:", category)
      }
    }
  }

  const unique = new Map<string, ListedArticle>()
  for (const article of listed) {
    const key = article.oid + "/" + article.aid
    const previous = unique.get(key)
    if (previous) { excluded++; reasons.duplicate_url = (reasons.duplicate_url || 0) + 1 }
    if (!previous || previous.publishedAt < article.publishedAt) unique.set(key, article)
  }
  const selected = [...unique.values()]
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime() || left.sourceUrl.localeCompare(right.sourceUrl))
    .slice(0, limit)
  const limited = unique.size - selected.length
  if (selected.length === 0) return { articles: [], partial: true, received, excluded, limited, reasons }
  if (metadataOnly) return { articles: selected.map((item) => ({ title: item.title, sourceUrl: item.sourceUrl,
    source: item.source, category: item.category, publishedAt: item.publishedAt, imageUrl: item.imageUrl })),
    partial, received, excluded, limited, reasons }

  const articles: SpecialArticle[] = []
  for (let offset = 0; offset < selected.length; offset += 3) {
    if (signal?.aborted) {
      partial = true
      const remaining = selected.length - offset
      excluded += remaining
      reasons.timeout = (reasons.timeout || 0) + remaining
      break
    }
    const batch = await Promise.all(
      selected.slice(offset, offset + 3).map(async (item) => {
        const { oid, aid, ...article } = item
        const host = category === "106" ? "api-gw.entertain.naver.com" : "api-gw.sports.naver.com"
        try {
          const detail = detailResponseSchema.parse(
            await fetchJson("https://" + host + "/news/article/" + oid + "/" + aid, signal)
          ).result.articleInfo.article
          if (detail.officeId !== oid || detail.articleId !== aid) {
            throw new Error("본문 기사 식별자가 목록과 다릅니다.")
          }
          article.content = plainText(detail.refinedContent) || plainText(detail.content) || undefined
          if (!article.content) partial = true
          article.description = plainText(detail.subcontent) || article.description
          article.author = plainText(detail.reporter) || undefined
          article.publishedAt = parseKoreanDate(detail.serviceDatetime) || article.publishedAt
        } catch {
          partial = true
          console.warn("네이버 특수 카테고리 본문 수집 실패:", category, oid, aid)
        }
        return article
      })
    )
    articles.push(...batch)
  }
  return { articles, partial, received, excluded, limited, reasons }
}
