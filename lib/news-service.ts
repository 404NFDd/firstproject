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
  "developer",
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
  developer: ["개발자", "프로그래밍", "코딩", "소프트웨어 개발", "개발 이슈", "프로그래머", "개발자 뉴스"],
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

const RSS_FEEDS = [
  { category: "technology", url: "https://www.techmeme.com/feed.xml" },
  { category: "business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { category: "science", url: "https://www.sciencemag.org/rss/news_current.xml" },
  { category: "general", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { category: "developer", url: "https://dev.to/feed" },
  { category: "developer", url: "https://news.ycombinator.com/rss" },
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
        isTranslated: article.source === "NewsAPI" ? 1 : 0, // NewsAPI에서 가져온 기사는 번역 완료로 표시
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

    // 먼저 모든 기사의 원문을 수집
    const rawArticles = articles
      .map((item, index) => {
        // 원본 데이터 확인 (디버깅용 - 첫 번째 기사만)
        if (index === 0) {
          console.log("📰 NewsAPI 원본 데이터 확인:")
          console.log(`  - title 원본:`, item.title?.substring(0, 100))
          console.log(`  - description 원본:`, item.description?.substring(0, 100))
          console.log(`  - content 원본:`, item.content?.substring(0, 200))
          console.log(`  - content에 개행 있음:`, item.content?.includes("\n") || item.content?.includes("<br") || item.content?.includes("<p>"))
        }

        // 제목과 설명은 개행 제거 (한 줄로)
        const title = stripHtmlTags(item.title, false) || sanitizeString(item.title)
        const sourceUrl = sanitizeString(item.url)

        if (!title || !sourceUrl) {
          return null
        }

        // content는 개행 보존 (번역 시 개행 유지)
        const description = stripHtmlTags(item.description, false) || sanitizeString(item.description)
        const content = stripHtmlTags(item.content, true) || sanitizeString(item.content)

        // 처리 후 데이터 확인 (디버깅용 - 첫 번째 기사만)
        if (index === 0) {
          console.log("📝 stripHtmlTags 처리 후:")
          console.log(`  - content 처리 후:`, content?.substring(0, 200))
          console.log(`  - content에 개행 있음:`, content?.includes("\n"))
        }

        return {
          title,
          description,
          content,
          imageUrl: sanitizeString(item.urlToImage),
          sourceUrl,
          source: sanitizeString(item.source?.name) ?? "NewsAPI",
          author: sanitizeString(item.author),
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          category: options.category,
        }
      })
      .filter((item): item is Omit<NormalizedArticle, "priority"> => item !== null)

    // 모든 기사의 제목과 내용을 병렬로 번역
    const translatedArticles = await Promise.all(
      rawArticles.map(async (article) => {
        const translatedTitle = await translateToKorean(article.title)
        const translatedDescription = await translateToKorean(article.description)
        const translatedContent = await translateToKorean(article.content)

        return {
          ...article,
          title: translatedTitle || article.title,
          description: translatedDescription || article.description,
          content: translatedContent || article.content,
        }
      })
    )

    // 개발자 관련 키워드가 있으면 developer 카테고리로 재분류
    const categorizedArticles = translatedArticles.map((base) => {
      const finalCategory = detectDeveloperCategory(base) ? "developer" : base.category
      return {
        ...base,
        category: finalCategory,
        priority: calculatePriority({ ...base, category: finalCategory }),
      }
    })

    return categorizedArticles
  } catch (error) {
    console.error("Error fetching news from NewsAPI:", error)
    return []
  }
}

// Retry-After 헤더 파싱 헬퍼 함수
// Retry-After는 정수(초) 또는 HTTP 날짜 형식을 가질 수 있음
function parseRetryAfter(retryAfter: string | null): number | null {
  if (!retryAfter) return null

  const trimmed = retryAfter.trim()

  // 정수 형식인지 확인 (숫자로만 구성)
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    return isNaN(seconds) ? null : seconds * 1000 // 밀리초로 변환
  }

  // HTTP 날짜 형식인지 확인 (예: "Wed, 21 Oct 2015 07:28:00 GMT")
  const dateValue = Date.parse(trimmed)
  if (!isNaN(dateValue)) {
    const now = Date.now()
    const waitTime = dateValue - now
    // 과거 날짜이거나 너무 큰 값이면 null 반환
    return waitTime > 0 && waitTime < 86400000 ? waitTime : null // 최대 24시간
  }

  return null
}

// 네이버 API 요청 재시도 헬퍼 함수
async function fetchWithRetry(
  url: URL,
  headers: Record<string, string>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        next: { revalidate: 60 },
      })

      if (response.status === 429) {
        // Rate limit 초과 시 대기 시간 계산 (exponential backoff)
        const delay = baseDelay * Math.pow(2, attempt)
        const retryAfter = response.headers.get("Retry-After")
        const parsedWaitTime = parseRetryAfter(retryAfter)
        const waitTime = parsedWaitTime ?? delay

        // waitTime이 유효한지 확인 (NaN이 아닌지)
        if (isNaN(waitTime) || waitTime <= 0) {
          console.warn(`⚠️  네이버 API 요청 한도 초과 (429). Retry-After 헤더를 파싱할 수 없어 기본 딜레이(${delay / 1000}초)를 사용합니다.`)
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            continue
          } else {
            console.warn(`⚠️  네이버 API 요청 한도 초과 (429). 최대 재시도 횟수 초과.`)
            return null
          }
        }

        if (attempt < maxRetries - 1) {
          console.warn(`⚠️  네이버 API 요청 한도 초과 (429). ${waitTime / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`)
          await new Promise((resolve) => setTimeout(resolve, waitTime))
          continue
        } else {
          console.warn(`⚠️  네이버 API 요청 한도 초과 (429). 최대 재시도 횟수 초과.`)
          return null
        }
      }

      return response
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.warn(`⚠️  네이버 API 요청 오류. ${delay / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  return null
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

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]

    // 요청 간 딜레이 추가 (첫 번째 요청 제외, 네이버 API rate limit 방지)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500)) // 500ms 딜레이
    }

    try {
      const url = new URL(NAVER_SEARCH_API_ENDPOINT)
      url.searchParams.set("query", query)
      url.searchParams.set("display", String(Math.min(limitPerQuery, 100)))
      url.searchParams.set("start", "1")
      url.searchParams.set("sort", "sim") // 정확도순

      const headers = {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      }

      const response = await fetchWithRetry(url, headers)

      if (!response) {
        // 재시도 실패 시 해당 쿼리 건너뛰기
        continue
      }

      if (!response.ok) {
        if (response.status === 403) {
          console.warn(`⚠️  네이버 검색 API 권한이 없습니다. 개발자 센터에서 검색 API를 활성화해주세요.`)
        } else if (response.status !== 429) {
          // 429는 이미 fetchWithRetry에서 처리됨
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
          // 네이버 API는 description만 제공하므로 content로도 사용
          const cleanTitle = stripHtmlTags(item.title, false) || sanitizeString(item.title)
          const cleanDescription = stripHtmlTags(item.description, true) || sanitizeString(item.description) // 개행 보존
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

      // 네이버 API는 한국어 뉴스이므로 번역 불필요
      for (const base of validItems) {
        // 개발자 관련 키워드가 있으면 developer 카테고리로 재분류
        const finalCategory = detectDeveloperCategory(base) ? "developer" : base.category
        aggregated.push({
          ...base,
          category: finalCategory,
          priority: calculatePriority({ ...base, category: finalCategory }),
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

        // content는 개행 보존
        const description = stripHtmlTags(rawDescription, false) || sanitizeString(rawDescription)
        const content = stripHtmlTags(rawContent, true) || sanitizeString(rawContent)

        const base = {
          title,
          description,
          content,
          imageUrl: sanitizeString(item.enclosure?.url || item["media:content"]?.url),
          sourceUrl,
          source: sanitizeString(item.source?.value) ?? new URL(sourceUrl).hostname,
          author: sanitizeString(item.author?.name || item["dc:creator"]),
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          category: feed.category,
        }

        // RSS 피드 기사 번역
        const translatedTitle = await translateToKorean(base.title)
        const translatedDescription = await translateToKorean(base.description)
        const translatedContent = await translateToKorean(base.content)

        const translatedBase = {
          ...base,
          title: translatedTitle || base.title,
          description: translatedDescription || base.description,
          content: translatedContent || base.content,
        }

        // 개발자 관련 키워드가 있으면 developer 카테고리로 재분류
        const finalCategory = detectDeveloperCategory(translatedBase) ? "developer" : translatedBase.category
        aggregated.push({
          ...translatedBase,
          category: finalCategory,
          priority: calculatePriority({ ...translatedBase, category: finalCategory }),
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
