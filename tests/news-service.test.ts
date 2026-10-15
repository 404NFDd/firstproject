import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { getNews, getNewsDetail, ingestLatestNews } from "../lib/news-service"
import { GET as getDetailRoute } from "../app/api/news/[id]/route"
import { GET as getNewsRoute } from "../app/api/news/route"
import { GET as getSync, POST as postSync } from "../app/api/news/sync/route"
import { EXCLUDED_COMMUNITY_SOURCES, TECH_FEED_SOURCES, type TechFeedSource } from "../lib/feed-sources"
import { TECH_NEWS_CATEGORY_VALUES } from "../lib/news-categories"
import { PUBLISHED_SUMMARY_FILTER } from "../lib/news-summary-service"
import { CURATION_KIND, getCurationHash } from "../lib/news-curation"
import { newsQuerySchema, newsSyncSchema } from "../lib/news-validation"

const originalNews = prisma.news
const originalLogs = prisma.newsSyncLog
const originalTranslations = prisma.newsTranslation
let saved: Array<Record<string, unknown>>
let requests: string[]
let oldCronSecret: string | undefined
const articleUrl = "https://n.news.naver.com/mnews/article/001/0000000001"
const item = (url = articleUrl, title = "뉴스 제목", extra = "") => `<li><a class="sa_text_title" href="${url}"><strong>${title}</strong></a><div class="sa_text_press">언론사</div>${extra}</li>`
const detail = `<meta property="og:description" content="정확한 &amp; 설명"><span data-date-time="2026-10-01 00:30:00"></span><div id="dic_area"><p>첫 문장 &#xAC00;</p><script>가짜 본문</script><div>둘째 문장</div></div>`

interface FeedFixtureItem {
  url: string
  title?: string
}

function feedXml(source: TechFeedSource, items: FeedFixtureItem[] = [{ url: `https://feeds.example.com/${source.id}/1` }]): string {
  return `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>테스트 피드</title>${items.map(({ url, title }) => `<item><title><![CDATA[${title ?? `기술 소식 ${source.id}`}]]></title><link>${url}</link><pubDate>Wed, 30 Sep 2026 15:30:00 GMT</pubDate><description><![CDATA[확인한 피드 소개]]></description><content:encoded><![CDATA[확인한 실제 피드 본문]]></content:encoded></item>`).join("")}</channel></rss>`
}

function installFeedFixtures(override?: (url: string, source?: TechFeedSource) => Response | undefined) {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    const source = TECH_FEED_SOURCES.find((entry) => entry.url === url)
    const response = override?.(url, source)
    if (response) return response
    if (source) return new Response(feedXml(source))
    if (url.includes("/section/")) return new Response(item())
    if (url === articleUrl) return new Response(detail)
    if (url.startsWith("https://api-gw.entertain.naver.com/") || url.startsWith("https://api-gw.sports.naver.com/")) {
      return new Response("", { status: 403 })
    }
    throw new Error(`테스트에 정의되지 않은 외부 요청: ${url}`)
  })
}

beforeEach(() => {
  saved = []
  requests = []
  oldCronSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = "test-cron-secret"
  Object.defineProperty(prisma, "news", { value: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { const row={id:"saved-"+(saved.length+1),...data}; saved.push(row); return row },
    findMany: async () => [],
    count: async () => 0,
  }, writable: true, configurable: true })
  Object.defineProperty(prisma,"newsTranslation",{value:{
    findMany:async()=>[],createMany:async({data}:{data:unknown[]})=>({count:data.length}),
    updateMany:async()=>({count:0}),deleteMany:async()=>({count:0}),
  },writable:true,configurable:true})
  Object.defineProperty(prisma, "newsSyncLog", { value: {
    findFirst: async () => null, create: async () => ({ id: "log" }), update: async () => ({}), updateMany: async () => ({ count: 0 }),
  }, writable: true, configurable: true })
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url.includes("/section/")) return new Response(item())
    if (url === articleUrl) return new Response(detail)
    throw new Error(`테스트에 정의되지 않은 외부 요청: ${url}`)
  })
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
})

afterEach(() => {
  mock.restoreAll()
  Object.defineProperty(prisma, "news", { value: originalNews, writable: true, configurable: true })
  Object.defineProperty(prisma,"newsTranslation",{value:originalTranslations,writable:true,configurable:true})
  Object.defineProperty(prisma, "newsSyncLog", { value: originalLogs, writable: true, configurable: true })
  if (oldCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = oldCronSecret
})

test("상세 HTML에서 발행정보만 저장하고 원문 소개와 본문은 저장하지 않는다", async () => {
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
  assert.equal(result.persisted, 1)
  assert.equal(saved[0].source, "언론사")
  assert.equal(saved[0].description, null)
  assert.equal((saved[0].publishedAt as Date).toISOString(), "2026-09-30T15:30:00.000Z")
  assert.equal(saved[0].content, null)
})

test("추적 쿼리와 중복 링크를 수량 제한 전에 제거한다", async () => {
  const secondUrl = "https://n.news.naver.com/mnews/article/001/0000000002"
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    return new Response(url.includes("/section/")
      ? item(`${articleUrl}?sid=100&amp;track=1`, "&#xAC00; &amp; 뉴스") + item(`${articleUrl}?sid=101`) + item(secondUrl, "두 번째 기사")
      : detail)
  })
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 2 })
  assert.equal(result.fetched, 2)
  assert.equal(result.persisted, 2)
  assert.equal(saved[0].sourceUrl, articleUrl)
  assert.equal(saved[0].title, "가 & 뉴스")
  assert.equal(requests.filter((url) => url === articleUrl).length, 1)
})

test("기사의 날짜가 없으면 다음 목록 항목의 날짜를 가져오지 않는다", async () => {
  const secondUrl = "https://n.news.naver.com/mnews/article/001/0000000002"
  const oldDate = '<span data-date-time="2001-01-01 12:00:00"></span>'
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/") ? item() + item(secondUrl, "과거 기사", oldDate) : "")
  })
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 2 })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].sourceUrl, secondUrl)
  assert.equal((saved[0].publishedAt as Date).toISOString(), "2001-01-01T03:00:00.000Z")
  assert.equal(result.fetched, 1)
  assert.deepEqual(result.failedCategories, ["100"])
})

test("잘못된 날짜를 다음 달 날짜로 자동 보정하지 않는다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/") ? item(articleUrl, "기사", '<span data-date-time="2001-02-31 10:00:00"></span>') : "")
  })
  await assert.rejects(ingestLatestNews({ categories: ["100"], limitPerCategory: 1 }), /수집된 뉴스가 없습니다/)
  assert.equal(saved.length, 0)
})

test("허용되지 않은 링크는 요청하지 않고 수집 실패를 반환한다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input))
    return new Response(item("https://example.com/article/1"))
  })
  await assert.rejects(ingestLatestNews({ categories: ["100"], limitPerCategory: 1 }), /수집된 뉴스가 없습니다/)
  assert.equal(requests.length, 1)
  assert.equal(saved.length, 0)
})

test("일시적인 503은 재시도하고 403은 재시도하지 않는다", async () => {
  let sectionCalls = 0
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (!String(input).includes("/section/")) return new Response(detail)
    sectionCalls++
    return sectionCalls === 1 ? new Response("", { status: 503 }) : new Response(item())
  })
  assert.equal((await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })).persisted, 1)
  assert.equal(sectionCalls, 2)
  sectionCalls = 0
  mock.method(globalThis, "fetch", async () => { sectionCalls++; return new Response("", { status: 403 }) })
  await assert.rejects(ingestLatestNews({ categories: ["100"], limitPerCategory: 1 }))
  assert.equal(sectionCalls, 1)
})

test("일부 카테고리 실패를 전체 성공으로 숨기지 않고 같은 기사 상세는 한 번만 가져온다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith("/section/102")) return new Response("", { status: 403 })
    return new Response(url.includes("/section/") ? item() : detail)
  })
  const result = await ingestLatestNews({ categories: ["100", "101", "102"], limitPerCategory: 1 })
  assert.deepEqual(result.failedCategories, ["102"])
  assert.equal(result.fetched, 1)
  assert.equal(requests.filter((url) => url === articleUrl).length, 1)
})

test("검색·최소 우선순위·동률 정렬을 MySQL 쿼리에 반영한다", async () => {
  const finder = mock.method(prisma.news, "findMany", async () => [])
  await getNews({ category: "105", search: "  개발  ", sort: "priority", minPriority: 30, page: 2, limit: 5 })
  const args = (finder.mock.calls[0].arguments as unknown as [unknown])[0] as { where: Record<string, unknown>; orderBy: unknown[]; skip: number; take: number }
  assert.deepEqual(args.where, { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, ...PUBLISHED_SUMMARY_FILTER, category: "105", OR: [{ title: { contains: "개발" } }, { description: { contains: "개발" } }, { translations: { some: { kind: CURATION_KIND, status: "ready", OR: [{ translatedTitle: { contains: "개발" } }, { translatedText: { contains: "개발" } }] } } }], priority: { gte: 30 } })
  assert.deepEqual(args.orderBy, [{ priority: "desc" }, { publishedAt: "desc" }, { id: "desc" }])
  assert.equal(args.skip, 5)
  assert.equal(args.take, 5)
})

test("잘못된 목록·수집 입력은 DB나 외부 소스를 호출하지 않는다", async () => {
  const finder = mock.method(prisma.news, "findMany", async () => [])
  const response = await getNewsRoute(new NextRequest("http://localhost/api/news?page=-1&limit=10000"))
  assert.equal(response.status, 400)
  await assert.rejects(ingestLatestNews({ categories: ["100"], limitPerCategory: 0 }))
  assert.equal(finder.mock.callCount(), 0)
  assert.deepEqual(requests, [])
})

test("미인증 수집은 DB 예약과 수집을 실행하지 않는다", async () => {
  const transaction = mock.method(prisma, "$transaction", async () => { throw new Error("호출되면 안 됨") })
  assert.equal((await postSync(new NextRequest("http://localhost/api/news/sync", { method: "POST" }))).status, 401)
  assert.equal((await getSync(new NextRequest("http://localhost/api/news/sync"))).status, 401)
  assert.equal(transaction.mock.callCount(), 0)
  assert.deepEqual(requests, [])
})

test("진행 중인 수집은 Retry-After와 429를 반환한다", async () => {
  mock.method(prisma, "$transaction", async () => ({ lastSync: { status: "processing", createdAt: new Date(Date.now() - 60_000) }, syncLog: null }))
  const response = await postSync(new NextRequest("http://localhost/api/news/sync", { method: "POST", headers: { "x-cron-secret": "test-cron-secret" } }))
  assert.equal(response.status, 429)
  assert.ok(Number(response.headers.get("retry-after")) > 200 && Number(response.headers.get("retry-after")) <= 240)
  assert.deepEqual(requests, [])
})

test("메타 설명의 비교 기호를 HTML 태그로 삭제하지 않는다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/") ? item() : `<meta property="og:description" content="3 &lt; 5 &gt; 2"><meta property="og:image" content="https://example.com/image?a=1&amp;b=2"><span data-date-time="2026-10-01 00:30:00"></span><div id="dic_area">본문</div>`)
  })
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
  assert.equal(saved[0].description, null)
  assert.equal(saved[0].imageUrl, "https://example.com/image?a=1&b=2")
  assert.deepEqual(result.failedCategories, [])
})

test("메타데이터 요청 실패는 부분 실패로 남기고 원문 누락은 메타데이터 저장에 영향을 주지 않는다", async () => {
  for (const response of [new Response("", { status: 403 }), new Response("<html>본문 없음</html>")]) {
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      return String(input).includes("/section/") ? new Response(item(articleUrl, "뉴스 제목", '<span data-date-time="2026-10-01 00:30:00"></span>')) : response
    })
    const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
    assert.equal(result.persisted, 1)
    assert.deepEqual(result.failedCategories, response.status === 403 ? ["100"] : [])
  }
})

test("옛 기사 URL만 oid/aid로 변환하고 비기사 경로는 무시한다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/")
      ? item("https://news.naver.com/settings?oid=001&aid=0000000002", "잘못된 경로") + item("https://news.naver.com/main/read.naver?oid=001&amp;aid=0000000001", "옛 기사")
      : detail)
  })
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 2 })
  assert.equal(result.fetched, 1)
  assert.equal(saved[0].title, "옛 기사")
  assert.equal(saved[0].sourceUrl, articleUrl)
})

test("메타 속성은 시작 따옴표와 끝을 맞추며 다른 따옴표와 비교 기호를 보존한다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/") ? item() : `<meta content="한글 '인용' 후속 설명 3 < 5 > 2" property="og:description"><meta name='author' content='기자 &amp; 작가'><span data-date-time="2026-10-01 00:30:00"></span><div id="dic_area">본문</div>`)
  })
  await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
  assert.equal(saved[0].description, null)
  assert.equal(saved[0].author, "기자 & 작가")
})

test("중복 기사에 원문을 다시 저장하지 않고 기존 필드는 보존한다", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = []
  Object.defineProperty(prisma.news, "update", { value: mock.fn(async (args: { data: Record<string, unknown> }) => { updates.push(args); return args.data }), configurable: true, writable: true })
  mock.method(prisma.news, "findFirst", async () => ({ id: "existing", sourceUrl: articleUrl, content: null, description: "기존 설명", imageUrl: "기존 이미지", author: "기존 작성자" }))
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
  assert.equal(result.persisted, 0)
  assert.equal(result.skipped, 1)
  assert.equal(updates.length, 0)
  mock.method(prisma.news, "findFirst", async () => ({ id: "existing", sourceUrl: articleUrl, content: "기존 본문" }))
  assert.equal((await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })).skipped, 1)
  mock.method(prisma.news, "findFirst", async () => ({ id: "existing", sourceUrl: "다른 원문", content: null }))
  assert.equal((await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })).skipped, 1)
  assert.equal(updates.length, 0)
})


test("본문이 있어도 원문 발행시각을 확인할 수 없는 기사는 저장하지 않는다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/") ? item() : '<div id="dic_area">실제 본문</div>')
  })
  await assert.rejects(ingestLatestNews({ categories: ["100"], limitPerCategory: 1 }), /수집된 뉴스가 없습니다/)
  assert.equal(saved.length, 0)
})

test("목록의 잘못된 날짜는 상세에서 확인한 발행시각으로 보강한다", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    return new Response(String(input).includes("/section/")
      ? item(articleUrl, "뉴스 제목", '<span data-date-time="2026-02-30 10:00:00"></span>')
      : detail)
  })
  const result = await ingestLatestNews({ categories: ["100"], limitPerCategory: 1 })
  assert.equal(result.persisted, 1)
  assert.equal((saved[0].publishedAt as Date).toISOString(), "2026-09-30T15:30:00.000Z")
  assert.deepEqual(result.failedCategories, [])
})

test("연예 기사도 원문 소개와 본문을 저장하지 않으며 재수집에서 복구하지 않는다", async () => {
  let stored: Record<string, unknown> | null = null
  let hasDetail = false
  mock.method(prisma.news, "findFirst", async () => stored)
  mock.method(prisma.news, "create", async ({ data }: { data: Record<string, unknown> }) => {
    stored = { ...data, id: "special-existing" }
    return stored
  })
  Object.defineProperty(prisma.news, "update", { value: mock.fn(async ({ data }: { data: Record<string, unknown> }) => {
    stored = { ...stored, ...data }
    return stored
  }), configurable: true, writable: true })
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input))
    return Response.json(url.pathname === "/news/articles"
      ? { success: true, result: { newsList: [{ oid: "001", aid: "0000000001", title: "연예 기사", officeName: "언론사", articleDateTime: "2026-10-01T00:30:00", subContent: "원문 발췌" }] } }
      : { success: true, result: { articleInfo: { article: { officeId: "001", articleId: "0000000001", refinedContent: hasDetail ? "복구된 실제 본문" : "" } } } })
  })
  const first = await ingestLatestNews({ categories: ["106"], limitPerCategory: 1 })
  assert.equal(first.persisted, 1)
  assert.deepEqual(first.failedCategories, [])
  assert.equal(stored?.["content"], null)
  assert.equal(stored?.["description"], null)
  hasDetail = true
  const repaired = await ingestLatestNews({ categories: ["106"], limitPerCategory: 1 })
  assert.equal(repaired.persisted, 0)
  assert.equal(repaired.skipped, 1)
  assert.deepEqual(repaired.failedCategories, [])
  assert.equal(stored?.["content"], null)
  assert.equal(stored?.["description"], null)
})


test("기술 전체 조회는 네이버 IT와 다섯 기술 범주를 묶고 개별 범주와 전체 조회를 구분한다", async () => {
  const finder = mock.method(prisma.news, "findMany", async () => [])
  await getNews({ category: "tech" })
  const args = finder.mock.calls[0].arguments[0] as unknown as { where: Record<string, unknown> }
  assert.deepEqual(args.where, { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, ...PUBLISHED_SUMMARY_FILTER, category: { in: ["105", ...TECH_NEWS_CATEGORY_VALUES] } })
  for (const category of TECH_NEWS_CATEGORY_VALUES) {
    assert.equal(newsQuerySchema.safeParse({ category }).success, true)
    assert.equal((await getNewsRoute(new NextRequest(`http://localhost/api/news?category=${category}`))).status, 200)
    const latest = finder.mock.calls.at(-1)!.arguments[0] as unknown as { where: Record<string, unknown> }
    assert.deepEqual(latest.where, { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, ...PUBLISHED_SUMMARY_FILTER, category })
  }
  await getNews({ category: "all" })
  const all = finder.mock.calls.at(-1)!.arguments[0] as unknown as { where: Record<string, unknown> }
  assert.deepEqual(all.where, { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, ...PUBLISHED_SUMMARY_FILTER })
  assert.equal((await getNewsRoute(new NextRequest("http://localhost/api/news?category=tech"))).status, 200)
})

test("수집 범위의 기본값과 13개 실제 범주를 검증하고 조회용 필터는 수집 배열에서 거절한다", async () => {
  assert.equal(newsSyncSchema.parse({}).scope, "tech")
  assert.equal(newsSyncSchema.safeParse({ categories: ["100", "101", "102", "103", "104", "105", "106", "107", ...TECH_NEWS_CATEGORY_VALUES] }).success, true)
  const transaction = mock.method(prisma, "$transaction", async () => { throw new Error("호출되면 안 됨") })
  for (const payload of [{ scope: "unknown" }, { categories: ["all"] }, { categories: ["tech"] }, { categories: Array(14).fill("developer") }]) {
    const response = await postSync(new NextRequest("http://localhost/api/news/sync", {
      method: "POST", headers: { "x-cron-secret": "test-cron-secret" }, body: JSON.stringify(payload),
    }))
    assert.equal(response.status, 400)
  }
  assert.equal(transaction.mock.callCount(), 0)
  assert.deepEqual(requests, [])
})

test("기본 수집은 네이버 IT와 연결된 전체 기술 피드를 저장하고 새 범주에 같은 가중치를 적용한다", async () => {
  installFeedFixtures()
  const result = await ingestLatestNews()
  assert.equal(result.persisted, TECH_FEED_SOURCES.length + 1)
  assert.deepEqual(result.failedCategories, [])
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(requests.filter((url) => url.includes("/section/")), ["https://news.naver.com/section/105"])
  assert.deepEqual(new Set(saved.map((article) => article.category)), new Set(["105", ...TECH_NEWS_CATEGORY_VALUES]))
  assert.deepEqual(new Set(requests.filter((url) => TECH_FEED_SOURCES.some((source) => source.url === url))), new Set(TECH_FEED_SOURCES.map((source) => source.url)))
  assert.ok(saved.every((article) => article.priority === saved[0].priority))
})

test("명시한 범주는 전체 수집 범위보다 우선하고 피드 수량 제한은 소스마다 적용한다", async () => {
  installFeedFixtures((_url, source) => source ? new Response(feedXml(source, [1, 2, 3].map((index) => ({ url: `https://feeds.example.com/${source.id}/${index}` })))) : undefined)
  const result = await ingestLatestNews({ scope: "all", categories: ["release"], limitPerCategory: 1 })
  const releases = TECH_FEED_SOURCES.filter((source) => source.category === "release")
  assert.equal(result.persisted, releases.length)
  assert.deepEqual(new Set(requests), new Set(releases.map((source) => source.url)))
  assert.ok(saved.every((article) => article.category === "release"))
  assert.deepEqual(result.failedSources, [])
})

test("전체 수집 옵션은 기존 여덟 네이버 범주와 새 기술 피드를 모두 선택한다", async () => {
  installFeedFixtures()
  const result = await ingestLatestNews({ scope: "all", limitPerCategory: 1 })
  assert.deepEqual(new Set(requests.filter((url) => url.includes("/section/"))), new Set(["100", "101", "102", "103", "104", "105"].map((category) => `https://news.naver.com/section/${category}`)))
  assert.ok(requests.some((url) => url.startsWith("https://api-gw.entertain.naver.com/")))
  assert.ok(requests.some((url) => url.startsWith("https://api-gw.sports.naver.com/")))
  assert.deepEqual(new Set(requests.filter((url) => TECH_FEED_SOURCES.some((source) => source.url === url))), new Set(TECH_FEED_SOURCES.map((source) => source.url)))
  assert.deepEqual(result.failedCategories, ["106", "107"])
  assert.deepEqual(result.failedSources, [])
  assert.equal(result.persisted, TECH_FEED_SOURCES.length + 1)
})

test("일부 피드 실패는 소스 ID를 남기며 정상 네이버 기사와 나머지 피드를 저장한다", async () => {
  const failed = TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!
  installFeedFixtures((_url, source) => source?.id === failed.id ? new Response("", { status: 403 }) : undefined)
  const result = await ingestLatestNews({ categories: ["105", "developer"], limitPerCategory: 1 })
  assert.equal(result.persisted, 2)
  assert.deepEqual(result.failedCategories, [])
  assert.deepEqual(result.failedSources, [failed.id])
  assert.ok(saved.some((article) => article.category === "105"))
  assert.ok(saved.some((article) => article.source === "Microsoft Visual Studio"))
})

test("네이버 실패가 정상 기술 피드의 저장을 중단하지 않는다", async () => {
  installFeedFixtures((url) => url.endsWith("/section/105") ? new Response("", { status: 403 }) : undefined)
  const result = await ingestLatestNews({ categories: ["105", "release"], limitPerCategory: 1 })
  assert.equal(result.persisted, TECH_FEED_SOURCES.filter((source) => source.category === "release").length)
  assert.deepEqual(result.failedCategories, ["105"])
  assert.deepEqual(result.failedSources, [])
})

test("네이버와 피드 모두 유효한 기사가 없으면 DB 저장 없이 수집 실패를 반환한다", async () => {
  installFeedFixtures(() => new Response("", { status: 403 }))
  await assert.rejects(ingestLatestNews({ categories: ["105", "developer"], limitPerCategory: 1 }), /수집된 뉴스가 없습니다.*105.*jetbrains-idea.*visual-studio/)
  assert.deepEqual(saved, [])
})

test("네이버와 다른 피드가 같은 링크를 제공하면 메타데이터 한 건만 저장한다", async () => {
  installFeedFixtures((_url, source) => source ? new Response(feedXml(source, [{ url: articleUrl, title: "같은 원문의 피드 제목" }])) : undefined)
  const result = await ingestLatestNews({ categories: ["105", "developer"], limitPerCategory: 1 })
  assert.equal(result.persisted, 1)
  assert.equal(result.fetched, 1)
  assert.equal(saved[0].sourceUrl, articleUrl)
  assert.equal(saved[0].content, null)
  assert.deepEqual(result.failedSources, [])
})

test("같은 피드의 반복 제목도 원문 URL이 다르면 별도로 저장하고 URL로 DB 중복을 조회한다", async () => {
  const queries: Array<Record<string, unknown>> = []
  mock.method(prisma.news, "findFirst", async ({ where }: { where: Record<string, unknown> }) => {
    queries.push(where)
    return saved.find((article) => article.sourceUrl === where.sourceUrl) ?? null
  })
  installFeedFixtures((_url, source) => source ? new Response(feedXml(source, [1, 2].map((index) => ({ url: `https://feeds.example.com/${source.id}/${index}`, title: "보안 업데이트" })))) : undefined)
  const result = await ingestLatestNews({ categories: ["release"], limitPerCategory: 2 })
  assert.equal(result.persisted, TECH_FEED_SOURCES.filter((source) => source.category === "release").length * 2)
  assert.equal(new Set(saved.map((article) => article.sourceUrl)).size, result.persisted)
  assert.ok(saved.every((article) => article.title === "보안 업데이트"))
  assert.deepEqual(queries, saved.map((article) => ({ sourceUrl: article.sourceUrl })))
  const second = await ingestLatestNews({ categories: ["release"], limitPerCategory: 2 })
  assert.equal(second.persisted, 0)
  assert.equal(second.skipped, result.persisted)
})

test("수집 API는 피드 일부 실패를 partial로 기록하고 로그에 소스명을 제공한다", async () => {
  const failed = TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!
  installFeedFixtures((_url, source) => source?.id === failed.id ? new Response("", { status: 403 }) : undefined)
  mock.method(prisma, "$transaction", async () => ({ lastSync: null, syncLog: { id: "log" } }))
  const updater = mock.method(prisma.newsSyncLog, "update", async () => ({}))
  const response = await postSync(new NextRequest("http://localhost/api/news/sync", {
    method: "POST", headers: { "x-cron-secret": "test-cron-secret" }, body: JSON.stringify({ categories: ["105", "developer"], limitPerCategory: 1 }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.failedSources, [failed.id])
  const args = updater.mock.calls[0].arguments[0] as unknown as { data: { status: string; error: string } }
  assert.equal(args.data.status, "partial")
  assert.match(args.data.error, /JetBrains IntelliJ IDEA/)
})

test("인증한 Cron의 빈 GET 요청도 기술 소식 기본 범위를 사용한다", async () => {
  installFeedFixtures()
  mock.method(prisma, "$transaction", async () => ({ lastSync: null, syncLog: { id: "log" } }))
  const updater = mock.method(prisma.newsSyncLog, "update", async () => ({}))
  const response = await getSync(new NextRequest("http://localhost/api/news/sync", { headers: { "x-cron-secret": "test-cron-secret" } }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.persisted, TECH_FEED_SOURCES.length + 1)
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(requests.filter((url) => url.includes("/section/")), ["https://news.naver.com/section/105"])
  const args = updater.mock.calls[0].arguments[0] as unknown as { data: { status: string; error: null } }
  assert.equal(args.data.status, "success")
  assert.equal(args.data.error, null)
})


test("개발 피드 목록은 커뮤니티 혼합 피드 대신 공식 제품 블로그를 사용한다", () => {
  assert.deepEqual(TECH_FEED_SOURCES.filter((source) => source.category === "developer").map((source) => source.id), ["jetbrains-idea", "visual-studio"])
  assert.ok(TECH_FEED_SOURCES.every((source) => !EXCLUDED_COMMUNITY_SOURCES.includes(source.name)))
  assert.ok(TECH_FEED_SOURCES.every((source) => !/news\.hada\.io|news\.ycombinator\.com/.test(source.url)))
})

test("기존 커뮤니티 글은 제외하고 공식 기사도 한국어 요약이 있어야 상세를 제공한다", async () => {
  let source = "GeekNews"
  Object.defineProperty(prisma.news, "findUnique", { configurable: true, writable: true,
    value: async () => ({ id: "community-news", source, category:"developer", title: "Android Developer Verification Program", content: null, sourceUrl:"https://devblogs.microsoft.com/visualstudio/test" }),
  })
  for (const excluded of EXCLUDED_COMMUNITY_SOURCES) {
    source = excluded
    const response = await getDetailRoute(new NextRequest("http://localhost/api/news/community-news"), { params: Promise.resolve({ id: "community-news" }) })
    assert.equal(response.status, 404)
    assert.equal(await getNewsDetail("community-news"), null)
  }
  source = "Microsoft Visual Studio"
  assert.equal(await getNewsDetail("community-news"), null)
  mock.method(prisma.newsTranslation,"findMany",async()=>[{newsId:"community-news",kind:CURATION_KIND,chunkIndex:0,status:"ready",sourceHash:getCurationHash({title:"Android Developer Verification Program",sourceUrl:"https://devblogs.microsoft.com/visualstudio/test"}),translatedText:JSON.stringify({selected:true,title:"개발자 확인 프로그램 공개",summary:"새로운 프로그램을 공개했습니다.",highlights:["한국어 핵심 내용"],sections:[],reason:"제품 발표",evidence:[]})}] as never)
  assert.equal((await getNewsDetail("community-news"))?.source, source)
  assert.equal((await getDetailRoute(new NextRequest("http://localhost/api/news/community-news"), { params: Promise.resolve({ id: "community-news" }) })).status, 200)
})

test("상세 API는 과거에 저장한 원문과 전문 번역을 응답에 포함하지 않는다", async () => {
  const article = { id:"detail-test",source:"Cloudflare Blog",category:"infrastructure",title:"Original title",sourceUrl:"https://blog.cloudflare.com/test",description:"Original introduction",content:"Full original article body" }
  Object.defineProperty(prisma.news,"findUnique",{configurable:true,value:async()=>article})
  mock.method(prisma.newsTranslation,"findMany",async()=>[{newsId:article.id,kind:CURATION_KIND,chunkIndex:0,status:"ready",sourceHash:getCurationHash(article),translatedText:JSON.stringify({selected:true,title:"한국어 제목",summary:"한국어 요약입니다.",highlights:["한국어 핵심 내용"],sections:[],reason:"제품 발표",evidence:[]})}] as never)
  const response=await getDetailRoute(new NextRequest("http://localhost/api/news/detail-test"),{params:Promise.resolve({id:article.id})})
  assert.equal(response.status,200)
  const data=await response.json()
  assert.equal(data.title,"한국어 제목")
  assert.equal(data.content,null)
  assert.equal("translation" in data,false)
  assert.equal(data.summary.selected,true)
  assert.doesNotMatch(JSON.stringify(data),/Original introduction|Full original article body/)
})


test("신규 메타데이터와 중복을 집계하며 원문 복구 건수는 늘리지 않는다", async () => {
  const urls = ["https://feeds.example.com/new", "https://feeds.example.com/repair", "https://feeds.example.com/duplicate"]
  installFeedFixtures((_url, source) => source ? new Response(feedXml(source, urls.map((url) => ({ url })))) : undefined)
  mock.method(prisma.news, "findFirst", async (args: unknown) => {
    const url = (args as { where: { sourceUrl: string } }).where.sourceUrl
    if (url === urls[0]) return null
    return { id: url, sourceUrl: url, content: url === urls[1] ? null : "이미 있는 본문" } as never
  })
  Object.defineProperty(prisma.news, "update", { value: mock.fn(async () => ({})), configurable: true })
  const result = await ingestLatestNews({ categories: ["developer"], limitPerCategory: 3 })
  assert.equal(result.createdCount, 1)
  assert.equal(result.repairedCount, 0)
  assert.equal(result.skipped, 2)
  assert.equal(result.persisted, 1)
  assert.equal(result.fetched, 3)
})

test("DB 저장 도중 실패해도 이미 저장한 건수와 출처 기록을 잃지 않는다", async () => {
  installFeedFixtures()
  let creates = 0
  mock.method(prisma.news, "create", async () => {
    if (++creates === 2) throw new Error("DB 장애")
    return {} as never
  })
  await assert.rejects(ingestLatestNews({ categories: ["developer"] }), (error: unknown) => {
    const result = (error as { result: { createdCount: number; sourceReports: { id: string }[] } }).result
    assert.equal(result.createdCount, 1)
    assert.ok(result.sourceReports.some((report) => report.id === "persistence"))
    return true
  })
})

test("기사 0건 수집 실패도 API의 실패 로그에 제외 사유를 남긴다", async () => {
  installFeedFixtures((_url, source) => source ? new Response("<rss><channel><title>빈 피드</title></channel></rss>") : undefined)
  mock.method(prisma, "$transaction", async () => ({ lastSync: null, syncLog: { id: "log" } }))
  const updater = mock.method(prisma.newsSyncLog, "update", async () => ({}))
  const response = await postSync(new NextRequest("http://localhost/api/news/sync", {
    method: "POST", headers: { "x-cron-secret": "test-cron-secret" }, body: JSON.stringify({ categories: ["developer"] }),
  }))
  assert.equal(response.status, 500)
  const data = (updater.mock.calls[0].arguments[0] as unknown as { data: { status: string; sourceReports: { status: string }[] } }).data
  assert.equal(data.status, "failed")
  assert.ok(data.sourceReports.every((report) => report.status === "failed"))
})


test("목록은 한국어 요약만 제공하고 원문을 읽거나 발췌하지 않는다", async () => {
  const article = { id: "preview-article", title: "기사 제목", description: "기사 제목", source: "공식 출처", publishedAt: new Date(), category: "105", priority: 10 }
  const query = mock.method(prisma.news, "findMany", async () => [article] as never)
  mock.method(prisma.news, "count", async () => 1)
  const raw = mock.method(prisma, "$queryRaw", async () => [{ id: article.id, excerpt: "실제 첫 문단입니다.\n\n두 번째 문단" }] as never)
  mock.method(prisma.newsTranslation, "findMany", async () => [{ newsId: article.id, kind: CURATION_KIND, status: "ready", sourceHash: getCurationHash(article), translatedText: JSON.stringify({ selected: true, title: "한국어 기사 제목", summary: "한국어로 요약한 내용입니다.", highlights: ["한국어 핵심 내용"], sections: [], evidence: [], reason: "새로운 소식" }) }] as never)
  const result = await getNews({ category: "105" })
  assert.equal(result.news[0].preview, "한국어로 요약한 내용입니다.")
  assert.equal(result.news[0].previewType, "summary")
  assert.equal("content" in result.news[0], false)
  assert.equal("description" in result.news[0], false)
  assert.equal((query.mock.calls[0].arguments[0] as { select: Record<string, boolean> }).select.content, undefined)
  assert.equal(raw.mock.calls.length, 0)
})


test("한 출처의 전체 수집 시간 초과가 다른 출처에서 확보한 기사의 저장을 막지 않는다", async () => {
  const controller = new AbortController()
  const slow = TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!
  mock.method(globalThis, "fetch", (input: string | URL | Request, init: RequestInit) => {
    const url = String(input)
    const source = TECH_FEED_SOURCES.find((source) => source.url === url)!
    if (source.id !== slow.id) return Promise.resolve(new Response(feedXml(source)))
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })
      setTimeout(() => controller.abort(new DOMException("시간 초과", "TimeoutError")), 20)
    })
  })
  const result = await ingestLatestNews({ categories: ["developer"] }, controller.signal)
  assert.equal(result.createdCount, 1)
  assert.equal(saved.length, 1)
  assert.deepEqual(result.failedSources, [slow.id])
  assert.equal(result.sourceReports.find((report) => report.id === slow.id)?.reasons.timeout, 1)
})


test("기술 피드는 언어와 무관하게 선별 큐에 넣고 수집 요청에서 AI를 호출하지 않는다", async () => {
  installFeedFixtures((_url, source) => source?.id === "naver-d2"
    ? new Response(feedXml(source).replace("확인한 실제 피드 본문", "This is an English article body."))
    : undefined)
  const queued = mock.method(prisma.newsTranslation,"createMany",async({data}:{data:unknown[]})=>({count:data.length}))
  await ingestLatestNews({categories:["engineering"],limitPerCategory:1})
  assert.equal(queued.mock.callCount(),TECH_FEED_SOURCES.filter(source=>source.category==="engineering").length)
  const jobs = queued.mock.calls[0].arguments[0]!.data as Array<{kind:string;status:string;newsId:string}>
  assert.deepEqual(jobs.map((job)=>job.kind),[CURATION_KIND])
  assert.equal(jobs.some((job)=>job.status==="pending"),true)
  assert.equal(jobs.every((job)=>Boolean(job.newsId)),true)
  assert.equal(requests.some((url)=>url.includes("generativelanguage.googleapis.com")),false)
})
