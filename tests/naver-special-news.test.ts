import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { fetchSpecialNews } from "../lib/naver-special-news"

const sportsSections = [
  "kbaseball", "wbaseball", "kfootball", "wfootball",
  "basketball", "volleyball", "golf", "general",
]

beforeEach(() => {
  mock.method(Date, "now", () => Date.parse("2026-09-30T16:00:00Z"))
  mock.method(console, "warn", () => {})
  mock.method(globalThis, "fetch", async () => {
    throw new Error("예상하지 않은 외부 요청")
  })
})

afterEach(() => mock.restoreAll())

function newsItem(overrides: Record<string, unknown> = {}) {
  return {
    oid: "001",
    aid: "0000000001",
    title: "기사 &amp; 제목",
    subContent: "기사 설명",
    officeName: "연예 언론사",
    sourceName: "스포츠 언론사",
    articleDateTime: "2026-10-01T00:10:00",
    dateTime: "2026-10-01T00:10:00",
    sportsSection: "general",
    image: "http://imgnews.pstatic.net/image/test.jpg",
    ...overrides,
  }
}

function listResponse(items: unknown[]): Response {
  return Response.json({ success: true, result: { newsList: items } })
}

function detailResponse(url: URL, overrides: Record<string, unknown> = {}): Response {
  const [, , , oid, aid] = url.pathname.split("/")
  return Response.json({
    success: true,
    result: { articleInfo: { article: {
      officeId: oid,
      articleId: aid,
      refinedContent: "상세 본문",
      reporter: "기자 이름",
      ...overrides,
    } } },
  })
}

test("연예 수집은 한국 날짜와 공개 API를 사용하며 중복·잘못된 기사·잘못된 날짜를 제외한다", async () => {
  const requested: URL[] = []
  mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    const url = new URL(input)
    requested.push(url)
    assert.equal(options.cache, "no-store")
    assert.equal(new Headers(options.headers).get("authorization"), null)
    if (url.pathname === "/news/articles") {
      assert.equal(url.host, "api-gw.entertain.naver.com")
      assert.equal(url.searchParams.get("date"), "20261001")
      assert.equal(url.searchParams.get("pageSize"), "2")
      return listResponse([
        newsItem(),
        newsItem({ articleDateTime: "2026-10-01T00:20:00" }),
        newsItem({ oid: "002", aid: "0000000002", articleDateTime: "2026-10-01T00:30:00" }),
        newsItem({ oid: "../private" }),
        newsItem({ oid: "003", aid: "0000000003", articleDateTime: "2026-02-30T00:30:00" }),
      ])
    }
    return detailResponse(url)
  })

  const result = await fetchSpecialNews("106", 2)
  assert.equal(result.partial, true)
  assert.equal(result.received, 5)
  assert.equal(result.excluded, 3)
  assert.deepEqual(result.reasons, { invalid_item: 1, invalid_date: 1, duplicate_url: 1 })
  assert.equal(result.articles.length, 2)
  assert.equal(result.articles[0].sourceUrl, "https://m.entertain.naver.com/now/article/002/0000000002")
  assert.equal(result.articles[1].publishedAt.toISOString(), "2026-09-30T15:20:00.000Z")
  assert.equal(result.articles[0].title, "기사 & 제목")
  assert.equal(result.articles[0].imageUrl, "https://imgnews.pstatic.net/image/test.jpg")
  assert.equal(result.articles[0].content, "상세 본문")
  assert.equal(result.articles[0].author, "기자 이름")
  assert.equal(requested.length, 3)
})

test("스포츠 8개 종목을 합쳐 최신순으로 제한하고 목록·본문 동시 요청을 3개로 제한한다", async () => {
  const sections: string[] = []
  let active = 0
  let maxActive = 0
  const fetchMock = mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    if (url.pathname.startsWith("/news/articles/")) {
      const section = url.pathname.split("/").at(-1)!
      const index = sportsSections.indexOf(section)
      sections.push(section)
      assert.equal(url.searchParams.get("date"), "2026-10-01")
      assert.equal(url.searchParams.get("sort"), "latest")
      return listResponse([
        newsItem({ aid: String(index + 2), sportsSection: section, dateTime: "2026-10-01T0" + index + ":00:00" }),
        newsItem(),
      ])
    }
    return detailResponse(url)
  })

  const result = await fetchSpecialNews("107", 3)
  assert.equal(result.partial, false)
  assert.deepEqual(sections, sportsSections)
  assert.equal(result.articles.length, 3)
  assert.deepEqual(result.articles.map((article) => new URL(article.sourceUrl).pathname.split("/")[1]), [
    "general", "golf", "volleyball",
  ])
  assert.equal(fetchMock.mock.callCount(), 11)
  assert.equal(maxActive, 3)
})

test("일부 스포츠 목록이 실패해도 다른 종목 기사를 보존하고 부분 실패로 표시한다", async () => {
  let failedSectionCalls = 0
  mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input)
    if (url.pathname === "/news/articles/kbaseball") {
      failedSectionCalls++
      return new Response("forbidden", { status: 403 })
    }
    return url.pathname.startsWith("/news/articles/")
      ? listResponse([newsItem()])
      : detailResponse(url)
  })

  const result = await fetchSpecialNews("107", 3)
  assert.equal(failedSectionCalls, 1)
  assert.equal(result.partial, true)
  assert.equal(result.articles.length, 1)
})

test("일시적인 429는 재시도하고 정상 반환된 목록으로 수집한다", async () => {
  let listCalls = 0
  mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input)
    if (url.pathname === "/news/articles") {
      listCalls++
      return listCalls === 1
        ? new Response("quota", { status: 429 })
        : listResponse([newsItem()])
    }
    return detailResponse(url)
  })

  const result = await fetchSpecialNews("106", 1)
  assert.equal(result.partial, false)
  assert.equal(result.articles.length, 1)
  assert.equal(listCalls, 2)
})

test("본문이 실패하거나 기사 식별자가 다르면 목록 설명을 보존한다", async (context) => {
  await context.test("본문 요청 실패", async () => {
    mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input)
      return url.pathname === "/news/articles"
        ? listResponse([newsItem()])
        : new Response("not found", { status: 404 })
    })
    const result = await fetchSpecialNews("106", 1)
    assert.equal(result.partial, true)
    assert.equal(result.articles[0].content, undefined)
    assert.equal(result.articles[0].description, "기사 설명")
  })
  await context.test("다른 기사의 본문", async () => {
    mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input)
      return url.pathname === "/news/articles"
        ? listResponse([newsItem()])
        : detailResponse(url, { articleId: "잘못된 ID" })
    })
    const result = await fetchSpecialNews("106", 1)
    assert.equal(result.partial, true)
    assert.equal(result.articles[0].content, undefined)
    assert.equal(result.articles[0].description, "기사 설명")
  })
})

test("평문 본문이 없으면 HTML에서 실행 요소를 제거하고 개행·문자를 복원한다", async () => {
  mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input)
    return url.pathname === "/news/articles"
      ? listResponse([newsItem({ image: "javascript:alert(1)", thumbnail: "" })])
      : detailResponse(url, {
        refinedContent: "",
        content: "<script>alert(1)</script><p>첫 문장 &amp; &#39;인용&#39;</p><br>둘째 문장",
        serviceDatetime: "2026-10-01 01:20:00",
      })
  })

  const result = await fetchSpecialNews("106", 1)
  assert.equal(result.partial, false)
  assert.equal(result.articles[0].imageUrl, undefined)
  assert.equal(result.articles[0].content, "첫 문장 & '인용'\n\n둘째 문장")
  assert.equal(result.articles[0].publishedAt.toISOString(), "2026-09-30T16:20:00.000Z")
})

test("빈 목록과 잘못된 응답은 성공으로 표시하지 않는다", async (context) => {
  await context.test("빈 목록", async () => {
    mock.method(globalThis, "fetch", async () => listResponse([]))
    assert.deepEqual(await fetchSpecialNews("106", 1), { articles: [], partial: true, received: 0, excluded: 0, limited: 0, reasons: {} })
  })
  await context.test("잘못된 응답 구조", async () => {
    mock.method(globalThis, "fetch", async () => Response.json({ success: true, result: {} }))
    assert.deepEqual(await fetchSpecialNews("106", 1), { articles: [], partial: true, received: 0, excluded: 0, limited: 0, reasons: { source_error: 1 } })
  })
})

test("잘못된 수집 수량은 API 요청 전에 거부한다", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => listResponse([]))
  for (const limit of [0, -1, 51, 1.5, Number.NaN]) {
    await assert.rejects(fetchSpecialNews("106", limit), RangeError)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
})


test("본문 요청이 성공해도 상세 본문이 없으면 설명을 본문으로 저장하지 않는다", async () => {
  for (const category of ["106", "107"] as const) {
    mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input)
      return url.pathname.startsWith("/news/articles")
        ? listResponse([newsItem()])
        : detailResponse(url, { refinedContent: " ", content: "<script>가짜 본문</script>", subcontent: "보강된 설명" })
    })
    const result = await fetchSpecialNews(category, 1)
    assert.equal(result.partial, true)
    assert.equal(result.articles.length, 1)
    assert.equal(result.articles[0].content, undefined)
    assert.equal(result.articles[0].description, "보강된 설명")
  }
})
