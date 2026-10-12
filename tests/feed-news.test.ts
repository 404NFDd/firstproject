import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { fetchTechFeeds } from "../lib/feed-news"
import { TECH_FEED_SOURCES } from "../lib/feed-sources"

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>개발 피드</title><link>https://news.hada.io/</link><description>공개 개발 소식</description>
    <item>
      <title>SDK 4.2 &amp; Node.js 24</title>
      <link>https://news.hada.io/topic?id=100&amp;utm_source=rss&amp;keep=yes#discussion</link>
      <pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate>
      <dc:creator>Dev &amp; Team</dc:creator>
      <description><![CDATA[<p>SDK 4.2 공개 &amp; API 변경.</p><script>alert(1)</script><p>코드 a < b && c > d</p>]]></description>
      <content:encoded><![CDATA[<p>피드가 제공한 긴 본문.</p>]]></content:encoded>
    </item>
    <item><title>New JavaScript runtime release</title><link>https://example.com/releases/2</link><pubDate>Fri, 02 Oct 2026 01:00:00 +0000</pubDate><content:encoded>런타임 변경 사항.</content:encoded></item>
    <item><title>날짜가 없는 항목</title><link>https://example.com/missing-date</link></item>
    <item><title>위험한 링크</title><link>javascript:alert(1)</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate></item>
    <item><title></title><link>https://example.com/missing-title</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate></item>
  </channel>
</rss>`

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>NAVER D2</title><updated>2026-10-02T12:00:00+09:00</updated>
  <entry>
    <id>tag:d2.naver.com,2026:entry-1</id><title>분산 시스템 운영</title>
    <link rel="self" href="https://d2.naver.com/d2.atom"/>
    <link rel="alternate" href="https://d2.naver.com/helloworld/100?utm_medium=feed&amp;id=100"/>
    <published>2026-09-30T10:00:00+09:00</published><updated>2026-10-02T10:00:00+09:00</updated>
    <author><name>D2 엔지니어</name></author>
    <summary type="html">&lt;p&gt;운영 경험 &amp;amp; 관측 소개.&lt;/p&gt;</summary>
    <content type="html">&lt;p&gt;피드가 제공한 전체 내용을 저장합니다.&lt;/p&gt;</content>
  </entry>
  <entry><id>invalid-date</id><title>날짜 오류</title><link href="https://d2.naver.com/bad"/><published>날짜 아님</published><updated>2026-02-31T10:00:00Z</updated></entry>
  <entry><id>updated-only</id><title>업데이트 시각만 있는 소식</title><link href="https://d2.naver.com/updated"/><updated>2026-10-01T03:00:00Z</updated><content>갱신된 실제 본문.</content></entry>
</feed>`

function rss(items: string): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test</title><link>https://example.com/</link><description>Test feed</description>${items}</channel></rss>`
}

function item(title: string, link: string, date = "Thu, 01 Oct 2026 03:00:00 GMT", description = ""): string {
  return `<item><title><![CDATA[${title}]]></title><link><![CDATA[${link}]]></link><pubDate>${date}</pubDate>${description ? "<description><![CDATA[" + description + "]]></description>" : ""}<content:encoded><![CDATA[${description || "실제 피드 본문."}]]></content:encoded></item>`
}

function xmlResponse(xml: string): Response {
  return new Response(xml, { headers: { "content-type": "application/xml" } })
}

beforeEach(() => {
  mock.method(console, "warn", () => {})
  mock.method(globalThis, "fetch", async () => { throw new Error("예상하지 않은 외부 요청") })
})
afterEach(() => mock.restoreAll())

test("RSS는 제공된 소개와 전체 본문·URL·날짜·영문 제목을 보존한다", async () => {
  mock.method(globalThis, "fetch", async (url: string) =>
    url === TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!.url
      ? xmlResponse(RSS_FIXTURE) : xmlResponse(rss("")))
  const result = await fetchTechFeeds({ categories: ["developer"] })

  assert.deepEqual(result.failedSources, ["visual-studio"])
  assert.equal(result.articles.length, 2)
  assert.equal(result.articles[0].title, "New JavaScript runtime release")
  assert.equal(result.articles[0].description, "런타임 변경 사항.")
  assert.equal(result.articles[0].publishedAt.toISOString(), "2026-10-02T01:00:00.000Z")
  const article = result.articles[1]
  assert.equal(article.title, "SDK 4.2 & Node.js 24")
  assert.equal(article.description, "SDK 4.2 공개 & API 변경. 코드 a < b && c > d")
  assert.equal(article.sourceUrl, "https://news.hada.io/topic?id=100&keep=yes#discussion")
  assert.equal(article.source, "JetBrains IntelliJ IDEA")
  assert.equal(article.author, "Dev & Team")
  assert.equal(article.category, "developer")
  assert.equal(article.content, "피드가 제공한 긴 본문.")
  assert.doesNotMatch(article.description!, /alert\(1\)|긴 본문/)
})

test("Atom은 published를 updated보다 우선하고 잘못된 항목만 버린다", async () => {
  mock.method(globalThis, "fetch", async (url: string) =>
    url === TECH_FEED_SOURCES.find((source) => source.id === "naver-d2")!.url
      ? xmlResponse(ATOM_FIXTURE) : xmlResponse(rss("")))
  const result = await fetchTechFeeds({ categories: ["engineering"] })

  assert.deepEqual(result.failedSources, ["toss-tech", "nolan-lawson", "mat-duggan", "the-new-stack"])
  assert.equal(result.articles.length, 2)
  assert.equal(result.articles[0].title, "업데이트 시각만 있는 소식")
  const article = result.articles[1]
  assert.equal(article.title, "분산 시스템 운영")
  assert.equal(article.publishedAt.toISOString(), "2026-09-30T01:00:00.000Z")
  assert.equal(article.sourceUrl, "https://d2.naver.com/helloworld/100?id=100")
  assert.equal(article.description, "운영 경험 & 관측 소개.")
  assert.equal(article.author, "D2 엔지니어")
  assert.equal(article.content, "피드가 제공한 전체 내용을 저장합니다.")
})

test("잘못된 날짜·상대 링크·자격증명 링크는 제외하고 피드 갱신 시각으로 대체하지 않는다", async () => {
  const xml = rss([
    item("숫자만 있는 날짜", "https://example.com/number-date", "2"),
    item("존재하지 않는 날짜", "https://example.com/bad-date", "Tue, 31 Feb 2026 03:00:00 GMT"),
    item("시간대 없음", "https://example.com/local-date", "2026-10-01T03:00:00"),
    item("상대 링크", "/news/1"),
    item("자격증명", "https://user:pass@example.com/news"),
    item("정상", "https://example.com/good"),
  ].join(""))
  mock.method(globalThis, "fetch", async () => xmlResponse(xml))
  const result = await fetchTechFeeds({ categories: ["ai"] })

  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(result.articles.map((article) => article.title), ["정상"])
  assert.equal(result.articles[0].publishedAt.toISOString(), "2026-10-01T03:00:00.000Z")
})

test("추적 파라미터만 제거해 URL 중복을 합치고 의미 있는 쿼리·제목 중복은 보존한다", async () => {
  mock.method(globalThis, "fetch", async (url: string) => xmlResponse(rss(
    url === TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!.url
      ? item("같은 제목", "https://example.com/read?id=1&utm_source=one&fbclid=tracking") +
        item("같은 제목", "https://example.com/read?id=2&ref=project")
      : item("동일 URL 최신 항목", "https://example.com/read?id=1&UTM_medium=two&gclid=tracking", "Fri, 02 Oct 2026 03:00:00 GMT")
  )))
  const result = await fetchTechFeeds({ categories: ["developer"] })

  assert.equal(result.articles.length, 2)
  assert.equal(result.articles[0].title, "동일 URL 최신 항목")
  assert.equal(result.articles[0].source, "Microsoft Visual Studio")
  assert.equal(result.articles[0].sourceUrl, "https://example.com/read?id=1")
  assert.equal(result.articles[1].sourceUrl, "https://example.com/read?id=2&ref=project")
  assert.deepEqual(result.failedSources, [])
})

test("소개는 최대 2000자이며 전체 본문은 자르지 않는다", async () => {
  const xml = rss(item("긴 소개", "https://example.com/long", undefined, "<p>" + "가".repeat(2500) + "</p>"))
  mock.method(globalThis, "fetch", async () => xmlResponse(xml))
  const result = await fetchTechFeeds({ categories: ["ai"] })

  assert.equal(result.articles[0].description!.length, 2000)
  assert.equal(result.articles[0].content!.length, 2500)
})

test("각 소스의 최신 기사부터 수집 수를 적용하고 1~50 밖의 값은 요청 전에 거부한다", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => xmlResponse(RSS_FIXTURE))
  const result = await fetchTechFeeds({ categories: ["ai"], limitPerSource: 1 })
  assert.deepEqual(result.articles.map((article) => article.title), ["New JavaScript runtime release"])
  assert.equal((await fetchTechFeeds({ categories: ["ai"], limitPerSource: 50 })).articles.length, 2)

  for (const limitPerSource of [0, -1, 51, 1.5, NaN, Infinity]) {
    await assert.rejects(fetchTechFeeds({ limitPerSource }), /1~50/)
  }
  assert.equal(fetchMock.mock.callCount(), 2)
})

test("카테고리 필터는 선택된 소스만 요청하고 빈 선택은 요청하지 않는다", async () => {
  const requested: string[] = []
  mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(url)
    return xmlResponse(RSS_FIXTURE)
  })
  const result = await fetchTechFeeds({ categories: ["release"] })

  assert.deepEqual(requested, TECH_FEED_SOURCES.filter((source) => source.category === "release").map((source) => source.url))
  assert.equal(result.articles.every((article) => article.category === "release"), true)
  assert.deepEqual(await fetchTechFeeds({ categories: [] }), { articles: [], failedSources: [], sourceReports: [] })
  assert.equal(requested.length, TECH_FEED_SOURCES.filter((source) => source.category === "release").length)
})

test("한 소스가 HTTP 403으로 실패해도 다른 소스의 기사를 보존하고 재시도하지 않는다", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (url: string) =>
    url === TECH_FEED_SOURCES.find((source) => source.id === "jetbrains-idea")!.url
      ? xmlResponse(RSS_FIXTURE) : new Response("forbidden", { status: 403 }))
  const result = await fetchTechFeeds({ categories: ["developer"] })

  assert.equal(result.articles.length, 2)
  assert.deepEqual(result.failedSources, ["visual-studio"])
  assert.equal(fetchMock.mock.callCount(), 2)
})

test("네트워크·429·5xx를 재시도하고 10초 timeout과 no-store를 설정한다", async (context) => {
  for (const failure of ["network", 429, 503] as const) {
    await context.test(String(failure), async () => {
      let attempts = 0
      const fetchMock = mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        assert.equal(init.cache, "no-store")
        assert.ok(init.signal instanceof AbortSignal)
        attempts++
        if (attempts === 1) {
          if (failure === "network") throw new DOMException("timeout", "TimeoutError")
          return new Response("temporary", { status: failure })
        }
        return xmlResponse(RSS_FIXTURE)
      })
      const timeoutMock = mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.ok([10_000, 60_000].includes(milliseconds))
        return new AbortController().signal
      })
      const result = await fetchTechFeeds({ categories: ["ai"] })

      assert.equal(result.articles.length, 2)
      assert.deepEqual(result.failedSources, [])
      assert.equal(fetchMock.mock.callCount(), 2)
      assert.deepEqual(timeoutMock.mock.calls.map((call) => call.arguments[0]), [60_000, 10_000, 10_000])
    })
  }
})
test("반복 네트워크 오류는 세 번째 요청 이후 중단하고 실패 소스를 기록한다", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("network failure") })
  const result = await fetchTechFeeds({ categories: ["ai"] })

  assert.equal(fetchMock.mock.callCount(), 3)
  assert.deepEqual(result.articles, [])
      assert.deepEqual(result.failedSources, ["hugging-face"])
      assert.equal(result.sourceReports[0].status, "failed")
})

test("빈 피드·인식 불가 XML·DTD 선언은 재시도 없이 해당 소스만 실패로 처리한다", async (context) => {
  for (const xml of [rss(""), "<html><body>not a feed</body></html>", '<!DOCTYPE rss [<!ENTITY value "unsafe">]>' + RSS_FIXTURE]) {
    await context.test(xml.slice(0, 45), async () => {
      const fetchMock = mock.method(globalThis, "fetch", async () => xmlResponse(xml))
      const result = await fetchTechFeeds({ categories: ["ai"] })
      assert.deepEqual(result.articles, [])
      assert.deepEqual(result.failedSources, ["hugging-face"])
      assert.equal(result.sourceReports[0].status, "failed")
      assert.equal(fetchMock.mock.callCount(), 1)
    })
  }
})

test("Content-Length와 실제 스트림 크기 모두 2MB 초과를 거부한다", async (context) => {
  await context.test("Content-Length", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(RSS_FIXTURE, {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    }))
    const result = await fetchTechFeeds({ categories: ["ai"] })
    assert.deepEqual(result.articles, [])
    assert.deepEqual(result.failedSources, ["hugging-face"])
    assert.equal(result.sourceReports[0].status, "failed")
    assert.equal(fetchMock.mock.callCount(), 1)
  })
  await context.test("실제 스트림", async () => {
    let canceled = false
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) },
      cancel() { canceled = true },
    })))
    const result = await fetchTechFeeds({ categories: ["ai"] })
    assert.deepEqual(result.articles, [])
    assert.deepEqual(result.failedSources, ["hugging-face"])
    assert.equal(result.sourceReports[0].status, "failed")
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(canceled, true)
  })
})

test("전체 소스 수집은 동시에 최대 3개씩 진행하고 결과를 최신순으로 반환한다", async () => {
  let active = 0
  let maxActive = 0
  const fetchMock = mock.method(globalThis, "fetch", async (url: string) => {
    active++
    maxActive = Math.max(maxActive, active)
    const index = TECH_FEED_SOURCES.findIndex((source) => source.url === url)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active--
    return xmlResponse(rss(item("소식 " + index, "https://example.com/news/" + index, "2026-10-01T" + String(index).padStart(2, "0") + ":00:00Z")))
  })
  const result = await fetchTechFeeds()

  assert.equal(maxActive, 3)
  assert.equal(fetchMock.mock.callCount(), TECH_FEED_SOURCES.length)
  assert.equal(result.articles.length, TECH_FEED_SOURCES.length)
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(result.articles.map((article) => article.title), [...TECH_FEED_SOURCES.keys()].reverse().map((index) => "소식 " + index))
})


test("GitHub의 CDATA 안 HTML DOCTYPE과 주석은 허용하고 XML DTD만 거부한다", async () => {
  const xml = RSS_FIXTURE
    .replace('<rss version="2.0"', '<!-- <!DOCTYPE rss SYSTEM "https://example.com/unused.dtd"> --><rss version="2.0"')
    .replace("<content:encoded><![CDATA[<p>", '<content:encoded><![CDATA[<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd"><html><body><p>')
  mock.method(globalThis, "fetch", async (url: string) =>
    url === TECH_FEED_SOURCES.find((source) => source.id === "github-changelog")!.url
      ? xmlResponse(xml) : xmlResponse(rss("")))
  const result = await fetchTechFeeds({ categories: ["release"], limitPerSource: 2 })

  assert.equal(result.articles.length, 2)
  assert.equal(result.articles[0].source, "GitHub Changelog")
  assert.deepEqual(result.failedSources, TECH_FEED_SOURCES.filter((source) => source.category === "release" && source.id !== "github-changelog").map((source) => source.id))
})

test("href 없는 Atom 링크 항목 하나 때문에 정상 항목을 잃지 않는다", async () => {
  const xml = ATOM_FIXTURE.replace(
    '<entry><id>invalid-date</id>',
    '<entry><title>링크 오류</title><link>https://example.com/bad</link><published>2026-10-01T03:00:00Z</published></entry><entry><id>invalid-date</id>'
  )
  mock.method(globalThis, "fetch", async (url: string) =>
    url === TECH_FEED_SOURCES.find((source) => source.id === "naver-d2")!.url
      ? xmlResponse(xml) : xmlResponse(rss("")))
  const result = await fetchTechFeeds({ categories: ["engineering"] })

  assert.equal(result.articles.length, 2)
  assert.equal(result.articles.some((article) => article.title === "링크 오류"), false)
  assert.deepEqual(result.failedSources, ["toss-tech", "nolan-lawson", "mat-duggan", "the-new-stack"])
})

test("실패 로그는 소스 id와 짧은 오류 메시지만 남긴다", async () => {
  mock.method(globalThis, "fetch", async () => new Response("전체 피드 본문은 로그에 남기지 않는다", { status: 403 }))
  const warning = mock.method(console, "warn", () => {})
  await fetchTechFeeds({ categories: ["ai"] })

  assert.deepEqual(warning.mock.calls[0].arguments, ["피드 수집에 실패했습니다:", "hugging-face", "피드 HTTP 오류: 403"])
})


test("제목과 소개만 제공하는 피드는 소개를 본문으로 대체하지 않고 제외한다", async () => {
  const xml = rss('<item><title>소개만 있는 글</title><link>https://example.com/intro</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate><description>짧은 소개</description></item>')
  mock.method(globalThis, "fetch", async () => xmlResponse(xml))
  const result = await fetchTechFeeds({ categories: ["developer"] })
  assert.equal(result.articles.length, 0)
  assert.deepEqual(result.failedSources, ["jetbrains-idea", "visual-studio"])
})

test("Hugging Face의 빈 본문은 최신 수집 범위만 공식 원문에서 보강한다", async () => {
  const xml = rss('<item><title>연구 발표</title><link>https://huggingface.co/blog/study</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate></item><item><title>과거 연구</title><link>https://huggingface.co/blog/old</link><pubDate>Wed, 30 Sep 2026 03:00:00 GMT</pubDate></item>')
  const requests: string[] = []
  mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    requests.push(url)
    if (url.endsWith("feed.xml")) return xmlResponse(xml)
    assert.equal(options?.redirect, "error")
    assert.equal(options?.cache, "no-store")
    return new Response('<div class="blog-content"><p>실제 연구 본문</p></div>')
  })
  const result = await fetchTechFeeds({ categories: ["ai"], limitPerSource: 1 })
  assert.equal(result.articles[0].content, "실제 연구 본문")
  assert.deepEqual(requests, ["https://huggingface.co/blog/feed.xml", "https://huggingface.co/blog/study"])
})

test("공식 원문에 기사 영역이 없으면 제목을 본문으로 만들지 않는다", async () => {
  const xml = rss('<item><title>연구</title><link>https://huggingface.co/blog/empty</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate></item>')
  mock.method(globalThis, "fetch", async (url: string) => url.endsWith("feed.xml") ? xmlResponse(xml) : new Response('<h1>연구</h1><article>추천 저장소</article>'))
  const result = await fetchTechFeeds({ categories: ["ai"] })
  assert.equal(result.articles.length, 0)
  assert.deepEqual(result.failedSources, ["hugging-face"])
})


test("출처별 본문 누락과 잘못된 날짜·URL을 실제 제외 사유로 집계한다", async () => {
  const xml = rss(
    item("정상 기사", "https://example.com/valid") +
    item("잘못된 날짜", "https://example.com/bad-date", "2026-02-31T00:00:00Z") +
    item("잘못된 URL", "javascript:alert(1)") +
    "<item><title>본문 없음</title><link>https://example.com/no-content</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate><description>소개</description></item>"
  )
  mock.method(globalThis, "fetch", async () => xmlResponse(xml))
  const result = await fetchTechFeeds({ categories: ["ai"] })
  const report = result.sourceReports[0]
  assert.equal(result.articles.length, 1)
  assert.equal(report.received, 4)
  assert.equal(report.accepted, 1)
  assert.equal(report.excluded, 3)
  assert.deepEqual(report.reasons, { invalid_date: 1, invalid_url: 1, missing_content: 1 })
  assert.equal(report.status, "partial")
  assert.ok(report.durationMs >= 0)
})

test("전체 수집 중단 신호는 진행 중 요청을 취소하고 재시도 없이 시간 초과를 기록한다", async () => {
  const controller = new AbortController()
  const fetchMock = mock.method(globalThis, "fetch", (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })
      controller.abort(new DOMException("중단", "TimeoutError"))
    }))
  const result = await fetchTechFeeds({ categories: ["ai"], signal: controller.signal })
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.deepEqual(result.failedSources, ["hugging-face"])
  assert.equal(result.sourceReports[0].reasons.timeout, 1)
})

test("PostgreSQL의 전체 RSS 공지는 본문으로 받고 다른 소스의 짧은 소개는 제외한다", async () => {
  const xml = rss('<item><title>릴리스 공지</title><link>https://www.postgresql.org/about/news/release-1/</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate><description><![CDATA[<h2>수정 내용</h2><p>전체 변경 공지 본문</p><ul><li>보안 패치</li></ul>]]></description></item>')
  mock.method(globalThis, "fetch", async () => xmlResponse(xml))
  const result = await fetchTechFeeds({ categories: ["release"], limitPerSource: 1 })
  assert.equal(result.articles.length, 1)
  assert.equal(result.articles[0].source, "PostgreSQL News")
  assert.equal(result.articles[0].content, "수정 내용\n\n전체 변경 공지 본문\n\n- 보안 패치")
})

test("Next.js의 RSS 소개 대신 공식 본문과 설치 명령을 보강한다", async () => {
  const source = TECH_FEED_SOURCES.find((entry) => entry.id === "nextjs")!
  const address = "https://nextjs.org/blog/security-release"
  const xml = rss('<item><title>보안 업데이트</title><link>' + address + '</link><pubDate>Thu, 01 Oct 2026 03:00:00 GMT</pubDate><description>짧은 소개</description></item>')
  const requests: string[] = []
  mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    requests.push(url)
    if (url === source.url) return xmlResponse(xml)
    if (url === address) {
      assert.equal(options?.redirect, "error")
      return new Response('<nav>추천 글</nav><div class="next-prose"><p>실제 보안 수정 내용</p><div class="not-prose"><button>복사</button><pre>npm install next@16.3.8</pre></div></div>')
    }
    return xmlResponse(rss(""))
  })
  const result = await fetchTechFeeds({ categories: ["release"], limitPerSource: 1 })
  assert.equal(result.articles.length, 1)
  assert.equal(result.articles[0].description, "짧은 소개")
  assert.match(result.articles[0].content!, /실제 보안 수정 내용/)
  assert.match(result.articles[0].content!, /npm install next@16\.3\.8/)
  assert.doesNotMatch(result.articles[0].content!, /짧은 소개|추천 글|복사/)
  assert.equal(requests.filter((url) => url === address).length, 1)
})

test("변경 내역 없이 version만 있는 릴리스는 건너뛰고 실제 변경 글을 수집한다", async () => {
  const source = TECH_FEED_SOURCES.find((entry) => entry.id === "laravel")!
  const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Laravel</title><entry><title>v11.57.0</title><link href="https://github.com/laravel/framework/releases/tag/v11.57.0"/><updated>2026-10-02T00:00:00Z</updated><content type="html">version</content></entry><entry><title>v13.34.0</title><link href="https://github.com/laravel/framework/releases/tag/v13.34.0"/><updated>2026-10-01T00:00:00Z</updated><content type="html">&lt;p&gt;실제 변경 내용&lt;/p&gt;</content></entry></feed>'
  mock.method(globalThis, "fetch", async (url: string) => xmlResponse(url === source.url ? xml : rss("")))
  const result = await fetchTechFeeds({ categories: ["release"], limitPerSource: 1 })
  assert.equal(result.articles.length, 1)
  assert.equal(result.articles[0].title, "v13.34.0")
  assert.equal(result.articles[0].content, "실제 변경 내용")
  const report = result.sourceReports.find((entry) => entry.id === source.id)!
  assert.equal(report.missingContent, 1)
  assert.equal(report.excluded, 1)
  assert.equal(report.status, "partial")
})
