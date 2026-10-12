import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { prisma } from "../lib/prisma"
import {
  formatSummarizedNewsHTML,
  summarizeArticle,
  summarizeNewsByCategory,
} from "../lib/ai-summary"

const article = {
  id: "news-1",
  title: "뉴스 제목",
  description: "기사 설명",
  content: "상세 기사 본문",
  source: "언론사",
  category: "100",
  publishedAt: new Date("2026-09-30T16:00:00Z"),
}

const envNames = ["GEMINI_API_KEY", "GEMINI_MODEL", "AI_SUMMARY_PROMPT"] as const
let originalEnv: Partial<Record<(typeof envNames)[number], string>>
let savedSummaries: Array<{ newsId: string; summary: string }>
const originalSummaryCache = prisma.newsSummary

beforeEach(() => {
  originalEnv = {}
  for (const name of envNames) {
    originalEnv[name] = process.env[name]
    delete process.env[name]
  }
  process.env.GEMINI_API_KEY = "test-api-key"
  savedSummaries = []
  // Prisma 프록시 대신 테스트용 delegate를 사용해 실제 DB 접근을 차단합니다.
  Object.defineProperty(prisma, "newsSummary", {
    value: { findUnique: async () => null, upsert: async () => ({}) },
    writable: true,
    configurable: true,
  })
  mock.method(prisma.newsSummary, "findUnique", async () => null)
  mock.method(
    prisma.newsSummary,
    "upsert",
    async (args: { create: { newsId: string; summary: string } }) => {
      savedSummaries.push(args.create)
      return args.create
    }
  )
  mock.method(globalThis, "fetch", async () => {
    throw new Error("예상하지 않은 외부 요청")
  })
  mock.method(console, "warn", () => {})
})

afterEach(() => {
  mock.restoreAll()
  Object.defineProperty(prisma, "newsSummary", {
    value: originalSummaryCache,
    writable: true,
    configurable: true,
  })
  for (const name of envNames) {
    if (originalEnv[name] === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = originalEnv[name]
    }
  }
})

function generatedResponse(summary: string): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: summary }] } }],
  })
}

test("기술 선별 단계의 요약은 브리핑에서 추가 API 요청 없이 재사용한다", async () => {
  const request=mock.method(globalThis,"fetch",async()=>{throw new Error("추가 요청 금지")})
  assert.equal(await summarizeArticle({...article,curatedSummary:"선별 단계에서 확인한 AI 요약"}),"선별 단계에서 확인한 AI 요약")
  assert.equal(request.mock.callCount(),0)
})

test("실제 요약 캐시는 API 키 없이도 재사용한다", async () => {
  delete process.env.GEMINI_API_KEY
  mock.method(prisma.newsSummary, "findUnique", async () => ({ summary: "저장된 AI 요약" }))
  const fetchMock = mock.method(globalThis, "fetch", async () => generatedResponse("새 요약"))

  assert.equal(await summarizeArticle(article), "저장된 AI 요약")
  assert.equal(fetchMock.mock.callCount(), 0)
  assert.deepEqual(savedSummaries, [])
})

test("API 키가 없는 경우 원문을 캐시에 저장하지 않고 다음 호출에서 재시도한다", async () => {
  delete process.env.GEMINI_API_KEY
  assert.equal(await summarizeArticle(article), article.description)
  assert.deepEqual(savedSummaries, [])

  process.env.GEMINI_API_KEY = "test-api-key"
  const fetchMock = mock.method(globalThis, "fetch", async () => generatedResponse("생성된 요약"))
  assert.equal(await summarizeArticle(article), "생성된 요약")
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.deepEqual(savedSummaries, [{ newsId: article.id, summary: "생성된 요약" }])
})

test("이전 버전이 저장한 원문 fallback은 실제 AI 요약으로 교체한다", async () => {
  mock.method(prisma.newsSummary, "findUnique", async () => ({ summary: article.description }))
  mock.method(globalThis, "fetch", async () => generatedResponse("새로운 AI 요약"))

  assert.equal(await summarizeArticle(article), "새로운 AI 요약")
  assert.equal(savedSummaries[0].summary, "새로운 AI 요약")
})

test("캐시 조회와 저장 실패가 기사 요약 전체를 중단하지 않는다", async () => {
  mock.method(prisma.newsSummary, "findUnique", async () => {
    throw new Error("캐시 DB 조회 실패")
  })
  mock.method(prisma.newsSummary, "upsert", async () => {
    throw new Error("캐시 DB 저장 실패")
  })
  mock.method(globalThis, "fetch", async () => generatedResponse("사용할 수 있는 요약"))

  assert.equal(await summarizeArticle(article), "사용할 수 있는 요약")
})

test("모델 설정과 API 키 헤더를 적용하고 프롬프트의 달러 문자를 보존한다", async () => {
  process.env.GEMINI_MODEL = "gemini-custom-model"
  process.env.AI_SUMMARY_PROMPT = "시작 {content} 끝 {content}"
  const specialArticle = { ...article, title: "$& $` $' $$ 가격", description: null, content: "본문 $& 정보" }
  let requestedUrl = ""
  let requestedInit: RequestInit | undefined
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requestedUrl = url
    requestedInit = init
    return Response.json({
      candidates: [{ content: { parts: [
        { text: "모델의 내부 사고", thought: true },
        { text: "  첫 문장. " },
        { text: " 둘째 문장.  " },
      ] } }],
    })
  })

  assert.equal(await summarizeArticle(specialArticle), "첫 문장.\n둘째 문장.")
  assert.match(requestedUrl, /\/models\/gemini-custom-model:generateContent$/)
  assert.equal(new URL(requestedUrl).search, "")
  assert.equal(new Headers(requestedInit?.headers).get("x-goog-api-key"), "test-api-key")
  const body = JSON.parse(String(requestedInit?.body))
  const prompt = body.contents[0].parts[0].text
  const content = specialArticle.title + "\n\n" + specialArticle.content
  assert.ok(prompt.endsWith("시작 " + content + " 끝 " + content))
  assert.match(prompt, /기사에 명시된 사실만/)
})

test("HTTP 오류, 네트워크 오류, 빈 응답은 fallback을 영구 캐시하지 않는다", async (context) => {
  await context.test("HTTP 오류", async () => {
    mock.method(globalThis, "fetch", async () => new Response("quota", { status: 429 }))
    assert.equal(await summarizeArticle(article), article.description)
    assert.deepEqual(savedSummaries, [])
  })
  await context.test("네트워크 오류", async () => {
    mock.method(globalThis, "fetch", async () => { throw new Error("timeout") })
    assert.equal(await summarizeArticle(article), article.description)
    assert.deepEqual(savedSummaries, [])
  })
  await context.test("빈 응답", async () => {
    mock.method(globalThis, "fetch", async () => generatedResponse("   "))
    assert.equal(await summarizeArticle(article), article.description)
    assert.deepEqual(savedSummaries, [])
  })
})

test("기본 모델로 요약하며 동시 요청 수를 3개로 제한하고 순서를 보존한다", async () => {
  let active = 0
  let maxActive = 0
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(url, /\/models\/gemini-3\.5-flash-lite:generateContent$/)
    active++
    maxActive = Math.max(maxActive, active)
    const title = JSON.parse(String(init.body)).contents[0].parts[0].text.match(/뉴스 제목 \d+/)[0]
    await new Promise((resolve) => setTimeout(resolve, 10))
    active--
    return generatedResponse("요약 " + title)
  })
  const articles = Array.from({ length: 8 }, (_, index) => ({
    ...article,
    id: "news-" + index,
    title: "뉴스 제목 " + index,
  }))

  const result = await summarizeNewsByCategory(articles)
  assert.equal(fetchMock.mock.callCount(), 8)
  assert.equal(maxActive, 3)
  assert.deepEqual(result["100"].map((item) => item.title), articles.map((item) => item.title))
  assert.deepEqual(result["100"].map((item) => item.summary), articles.map((item) => "요약 " + item.title))
})

test("메일 HTML은 숫자 카테고리, 한국 날짜와 외부 텍스트 이스케이프를 적용한다", () => {
  const summarizedArticle = {
    ...article,
    title: "<script>제목</script>",
    summary: '요약 & "내용"',
    source: "<b>언론사</b>",
  }
  const html = formatSummarizedNewsHTML({
    "100": [summarizedArticle],
    '<img src=x onerror="alert(1)">': [summarizedArticle],
  })

  assert.match(html, /📰 정치/)
  assert.match(html, /2026년 10월 1일/)
  assert.match(html, /&lt;script&gt;제목&lt;\/script&gt;/)
  assert.match(html, /요약 &amp; &quot;내용&quot;/)
  assert.match(html, /📰 기타/)
  assert.doesNotMatch(html, /<script>|<img src=x|<b>언론사/)
})


test("기본 프롬프트는 개발자에게 필요한 원문 사실과 제한을 전달한다", async () => {
  let prompt = ""
  const technicalArticle = {
    ...article,
    title: "SDK 4.2 공개",
    description: "2026년 9월 30일 배포",
    content: "SDK 4.2는 Node.js 24를 지원하며 3.x와 호환되지 않는다. CVE-2026-1234 수정이 포함됐다.",
  }
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    prompt = JSON.parse(String(init.body)).contents[0].parts[0].text
    return generatedResponse("SDK 4.2가 공개됐다.")
  })

  await summarizeArticle(technicalArticle)
  assert.match(prompt, /개발자와 IT 종사자/)
  assert.match(prompt, /변경 사항과 적용 대상/)
  assert.match(prompt, /버전·날짜·호환성·보안 정보/)
  assert.match(prompt, /기사에 없는 링크·날짜·통계를 만들지/)
  assert.match(prompt, /근거 없는 영향 평가나 실행·업그레이드 조언을 추가하지/)
  assert.ok(prompt.includes(technicalArticle.title))
  assert.ok(prompt.includes(technicalArticle.description))
  assert.ok(prompt.includes(technicalArticle.content))
})

test("메일용 결과는 실제 생성 및 캐시와 원문 fallback을 구분하고 원문 URL을 보존한다", async () => {
  const sourceUrl = "https://example.com/news/1?view=full&lang=ko"
  mock.method(globalThis, "fetch", async () => generatedResponse("생성한 AI 요약"))
  let result = await summarizeNewsByCategory([{ ...article, sourceUrl }])
  assert.equal(result["100"][0].summaryType, "ai")
  assert.equal(result["100"][0].sourceUrl, sourceUrl)

  delete process.env.GEMINI_API_KEY
  mock.method(prisma.newsSummary, "findUnique", async () => ({ summary: "저장된 AI 요약" }))
  result = await summarizeNewsByCategory([{ ...article, sourceUrl }])
  assert.equal(result["100"][0].summaryType, "ai")
  assert.equal(result["100"][0].summary, "저장된 AI 요약")

  mock.method(prisma.newsSummary, "findUnique", async () => null)
  result = await summarizeNewsByCategory([{ ...article, sourceUrl }])
  assert.equal(result["100"][0].summaryType, "excerpt")
  assert.equal(result["100"][0].summary, article.description)
})

test("본문이 없으면 AI 캐시와 API를 사용하지 않고 설명 또는 제목만 제공한다", async () => {
  const cacheMock = mock.method(prisma.newsSummary, "findUnique", async () => ({ summary: "과거 AI 요약" }))
  const fetchMock = mock.method(globalThis, "fetch", async () => generatedResponse("제목에서 만든 내용"))
  const result = await summarizeNewsByCategory([
    { ...article, id: "excerpt", content: "  " },
    { ...article, id: "title", content: null, description: "  " },
  ])

  assert.deepEqual(result["100"].map(({ summary, summaryType }) => ({ summary, summaryType })), [
    { summary: article.description, summaryType: "excerpt" },
    { summary: article.title, summaryType: "title" },
  ])
  assert.equal(await summarizeArticle({ ...article, content: null, description: null }), article.title)
  assert.equal(cacheMock.mock.callCount(), 0)
  assert.equal(fetchMock.mock.callCount(), 0)
  assert.deepEqual(savedSummaries, [])
})

test("요약 요청 실패는 원문 발췌로 표시하며 제목만 저장한 과거 캐시는 재생성한다", async () => {
  mock.method(prisma.newsSummary, "findUnique", async () => ({ summary: article.title }))
  mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }))
  let result = await summarizeNewsByCategory([article])
  assert.equal(result["100"][0].summaryType, "excerpt")
  assert.equal(result["100"][0].summary, article.description)
  assert.deepEqual(savedSummaries, [])

  mock.method(globalThis, "fetch", async () => generatedResponse("본문에서 다시 생성한 요약"))
  result = await summarizeNewsByCategory([article])
  assert.equal(result["100"][0].summaryType, "ai")
  assert.equal(result["100"][0].summary, "본문에서 다시 생성한 요약")
})

test("기사 본문 보강 이후에는 오래된 캐시를 다시 생성하고 실패 시 오래된 요약을 보내지 않는다", async () => {
  const updatedArticle = { ...article, updatedAt: new Date("2026-10-01T02:00:00Z") }
  const cacheMock = mock.method(prisma.newsSummary, "findUnique", async () => ({
    summary: "본문 보강 전 AI 요약",
    updatedAt: new Date("2026-10-01T01:00:00Z"),
  }))
  const fetchMock = mock.method(globalThis, "fetch", async () => generatedResponse("보강된 본문 요약"))

  assert.equal(await summarizeArticle(updatedArticle), "보강된 본문 요약")
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.equal(cacheMock.mock.calls[0].arguments[0]?.select?.updatedAt, true)

  mock.method(globalThis, "fetch", async () => new Response("quota", { status: 429 }))
  assert.equal(await summarizeArticle(updatedArticle), article.description)
})

test("최신 본문 이후에 생성된 요약 캐시는 다시 호출하지 않는다", async () => {
  mock.method(prisma.newsSummary, "findUnique", async () => ({
    summary: "최신 본문에서 생성한 요약",
    updatedAt: new Date("2026-10-01T03:00:00Z"),
  }))
  const fetchMock = mock.method(globalThis, "fetch", async () => generatedResponse("불필요한 새 요약"))
  const result = await summarizeNewsByCategory([{
    ...article,
    updatedAt: new Date("2026-10-01T02:00:00Z"),
  }])

  assert.equal(result["100"][0].summaryType, "ai")
  assert.equal(result["100"][0].summary, "최신 본문에서 생성한 요약")
  assert.equal(fetchMock.mock.callCount(), 0)
})

test("브리핑은 요약 유형과 실제 원문 링크를 표시하고 위험하거나 없는 URL은 표시하지 않는다", () => {
  const item = { ...article, summary: "내용", sourceUrl: "https://example.com/news?id=1&lang=ko" }
  const html = formatSummarizedNewsHTML({
    "105": [
      { ...item, summaryType: "ai" },
      { ...item, summaryType: "excerpt", sourceUrl: "http://example.com/news/2" },
      { ...item, summaryType: "title", sourceUrl: "javascript:alert(1)" },
      { ...item, sourceUrl: "/news/1" },
      { ...item, sourceUrl: "https://user:password@example.com/news" },
      { ...item, sourceUrl: null, publishedAt: new Date(NaN) },
    ],
  })

  assert.match(html, />AI 요약<\/p>/)
  assert.match(html, />원문 발췌<\/p>/)
  assert.match(html, />제목만 제공<\/p>/)
  assert.match(html, /href="https:\/\/example\.com\/news\?id=1&amp;lang=ko"/)
  assert.match(html, /href="http:\/\/example\.com\/news\/2"/)
  assert.equal((html.match(/>원문 읽기<\/a>/g) || []).length, 2)
  assert.doesNotMatch(html, /javascript:|href="\/news|password|Invalid Date/)
  assert.equal((html.match(/발행일:/g) || []).length, 5)
})

test("메일 카테고리는 기술 주제부터 공통 순서로 표시하고 기존 영문 카테고리를 지원한다", () => {
  const item = { ...article, summary: "내용" }
  const html = formatSummarizedNewsHTML({
    "100": [item],
    "101": [item],
    "105": [item],
    developer: [item],
    engineering: [item],
    ai: [item],
    infrastructure: [item],
    release: [item],
    business: [item],
    constructor: [item],
  })

  assert.ok(html.indexOf("📰 IT·과학") < html.indexOf("📰 경제"))
  assert.ok(html.indexOf("📰 경제") < html.indexOf("📰 정치"))
  assert.ok(html.indexOf("📰 개발·기술") < html.indexOf("📰 엔지니어링"))
  assert.ok(html.indexOf("📰 엔지니어링") < html.indexOf("📰 AI·연구"))
  assert.ok(html.indexOf("📰 AI·연구") < html.indexOf("📰 클라우드·인프라"))
  assert.ok(html.indexOf("📰 클라우드·인프라") < html.indexOf("📰 릴리스·도구"))
  assert.ok(html.indexOf("📰 릴리스·도구") < html.indexOf("📰 IT·과학"))
  assert.match(html, /📰 비즈니스/)
  assert.match(html, /📰 기타/)
  assert.doesNotMatch(html, /function Object/)
})


test("원문 제목·출처·fallback 엔티티는 한 번 해석하고 태그와 코드는 안전하게 표시한다", () => {
  const item = {
    ...article,
    title: "C&#43;&#43; &amp; &lt;script&gt;제목&lt;/script&gt;",
    source: "R&amp;D &lt;b&gt;언론사&lt;/b&gt;",
    summary: "&#x41; &amp; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; 코드 a < b && c > d",
  }

  for (const summaryType of ["excerpt", "title", undefined] as const) {
    const html = formatSummarizedNewsHTML({ "105": [{ ...item, summaryType }] })
    assert.match(html, /C\+\+ &amp; &lt;script&gt;제목&lt;\/script&gt;/)
    assert.match(html, /R&amp;D &lt;b&gt;언론사&lt;\/b&gt;/)
    assert.match(html, /A &amp; &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
    assert.match(html, /코드 a &lt; b &amp;&amp; c &gt; d/)
    assert.doesNotMatch(html, /&amp;amp;|&amp;lt;|&amp;#|<script>|<img src=x|<b>언론사/)
  }
})

test("AI 생성 요약은 엔티티 문자열과 코드 의미를 그대로 보존해 이스케이프한다", () => {
  const html = formatSummarizedNewsHTML({
    "105": [{
      ...article,
      summaryType: "ai",
      summary: "엔티티 &amp; 와 &#x41;, 코드 <script> 및 a < b && c > d",
    }],
  })

  assert.match(html, /엔티티 &amp;amp; 와 &amp;#x41;/)
  assert.match(html, /코드 &lt;script&gt; 및 a &lt; b &amp;&amp; c &gt; d/)
  assert.doesNotMatch(html, /<script>/)
})


test("기술 피드 브리핑은 게시·갱신 날짜와 소개·토론 페이지를 지원하는 출처 링크를 표시한다", () => {
  const html = formatSummarizedNewsHTML({
    engineering: [{ ...article, category: "engineering", summary: "피드가 제공한 소개", summaryType: "excerpt", sourceUrl: "https://d2.naver.com/helloworld/123" }],
  })
  assert.match(html, /게시·갱신일:/)
  assert.match(html, />출처에서 읽기<\/a>/)
  assert.match(html, /href="https:\/\/d2\.naver\.com\/helloworld\/123"/)
  assert.doesNotMatch(html, /발행일:|>원문 읽기<|AI 요약/)
})
