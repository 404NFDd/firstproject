import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NewsCard } from "../components/news-card"
import { decodeHtmlEntities } from "../lib/text"
import { getArticleContent } from "../lib/article-content"

test("한글과 일반 문자열을 보존하고 기본 HTML 엔티티를 디코딩한다", () => {
  assert.equal(decodeHtmlEntities("한글 & 원문 그대로"), "한글 & 원문 그대로")
  assert.equal(decodeHtmlEntities("&amp; &quot; &apos; &lt; &gt; &nbsp;"), "& \" ' < >  ")
  assert.equal(decodeHtmlEntities(null), "")
  assert.equal(decodeHtmlEntities(undefined), "")
})

test("뉴스의 따옴표와 말줄임표 및 숫자 유니코드를 디코딩한다", () => {
  assert.equal(decodeHtmlEntities("&ldquo;뉴스&rdquo;&mdash;&hellip; &#44032; &#x1F600;"), "“뉴스”—… 가 😀")
})

test("모르는 엔티티와 유효하지 않은 유니코드는 원문을 보존한다", () => {
  const text = "&unknown; &#0; &#xD800; &#1114112; &#99999999999999999999999; &#-1;"
  assert.equal(decodeHtmlEntities(text), text)
})

test("중첩된 엔티티를 한 번만 디코딩해 원문의 단계를 보존한다", () => {
  assert.equal(decodeHtmlEntities("&amp;lt;div&amp;gt;"), "&lt;div&gt;")
})

test("DOM 객체의 유무와 무관하게 같은 문자열을 반환한다", () => {
  const input = "제목 &amp; &#x1f600; &lt;b&gt;"
  const expected = decodeHtmlEntities(input)
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
  try {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true })
    Object.defineProperty(globalThis, "document", {
      value: { createElement: () => { throw new Error("엔티티 디코딩에서 DOM을 사용했습니다.") } },
      configurable: true,
    })
    assert.equal(decodeHtmlEntities(input), expected)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument)
    else Reflect.deleteProperty(globalThis, "document")
  }
})

function renderCard() {
  return renderToStaticMarkup(createElement(NewsCard, {
    id: "news-1",
    title: "제목 &amp; &#x1F600; &lt;script&gt;",
    description: "설명 &quot;본문&quot;",
    source: "언론사",
    publishedAt: "2026-10-01T00:00:00.000Z",
  }))
}

test("카드 SSR은 엔티티를 디코딩하고 React가 태그 문자를 안전하게 이스케이프한다", () => {
  const html = renderCard()
  assert.match(html, /제목 &amp; 😀 &lt;script&gt;/)
  assert.match(html, /설명 &quot;본문&quot;/)
  assert.doesNotMatch(html, /&amp;amp;|&amp;#x1F600;|<script>/)
})

test("카드 SSR의 날짜는 서버 시간대와 관계없이 한국 시간으로 렌더링한다", () => {
  const previousTimeZone = process.env.TZ
  try {
    process.env.TZ = "UTC"
    const utc = renderCard()
    process.env.TZ = "America/New_York"
    assert.equal(renderCard(), utc)
    assert.match(utc, /오전 09:00/)
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})
test("객체 프로토타입 이름도 모르는 엔티티로 보존한다", () => {
  assert.equal(decodeHtmlEntities("&constructor; &hasOwnProperty; &toString;"), "&constructor; &hasOwnProperty; &toString;")
})

test("제목을 반복하는 소개만 숨기고 기사 본문은 보존한다", () => {
  const content = "본문 첫 문단입니다.\n\n본문 두 번째 문단입니다."
  assert.deepEqual(getArticleContent({ title: "SDK 변경 안내", description: " SDK 변경 안내 ", content }), {
    title: "SDK 변경 안내", description: "", content,
  })
})

test("본문 시작을 반복하는 소개는 공백과 엔티티를 정리한 뒤 한 번만 표시한다", () => {
  const content = "새 SDK가 배포됐습니다.\n 지원 플랫폼 & 사용 방법을 확인하세요."
  const result = getArticleContent({
    title: "SDK 소식", description: "새 SDK가 배포됐습니다. 지원 플랫폼 &amp; 사용 방법을 확인하세요.", content,
  })
  assert.equal(result.description, "")
  assert.equal(result.content, content)
})

test("본문과 다른 소개 및 본문이 없는 기사의 소개를 보존한다", () => {
  const article = { title: "SDK 소식", description: "호환성을 확인하세요.", content: "새 SDK가 배포됐습니다." }
  assert.deepEqual(getArticleContent(article), article)
  assert.deepEqual(getArticleContent({ ...article, content: null }), { ...article, content: "" })
})

test("카드는 실제 카테고리·출처·작성자와 발행시각을 표시한다", () => {
  const html = renderToStaticMarkup(createElement(NewsCard, {
    id: "news-105", title: "개발 도구 소식", description: "새 버전 출시 안내",
    category: "105", source: "원문 출처", author: "작성자", publishedAt: "2026-10-01T00:00:00.000Z",
  }))
  assert.match(html, /IT·과학/)
  assert.match(html, /원문 출처/)
  assert.match(html, /작성: 작성자/)
  assert.match(html, /dateTime="2026-10-01T00:00:00.000Z"/)
  assert.match(html, /발행 2026년/)
})

test("소개가 없는 카드는 본문의 첫 문단을 발췌하고 없는 기사 내용은 만들지 않는다", () => {
  const html = renderToStaticMarkup(createElement(NewsCard, {
    id: "news-content", title: "개발 도구 소식", description: "", content: "실제 본문 첫 문단입니다.\n\n두 번째 문단입니다.",
    category: "105", source: "원문 출처", publishedAt: "2026-10-01T00:00:00.000Z",
  }))
  assert.match(html, /본문 발췌/)
  assert.match(html, /실제 본문 첫 문단입니다\./)
  assert.doesNotMatch(html, /두 번째 문단입니다/)
  const empty = renderToStaticMarkup(createElement(NewsCard, {
    id: "news-empty", title: "제목만 있는 기사", description: "제목만 있는 기사", content: null,
    source: "원문 출처", publishedAt: "2026-10-01T00:00:00.000Z",
  }))
  assert.match(empty, /소개 문구가 없는 소식입니다/)
})
test("이미지 없는 기술 소식 카드는 빈 이미지 영역 없이 제목과 소개를 표시한다", () => {
  const html = renderToStaticMarkup(createElement(NewsCard, {
    id: "tech-no-image", title: "기술 소식 제목", description: "피드에서 제공한 소개",
    category: "engineering", source: "기술 블로그", publishedAt: "2026-10-01T00:00:00.000Z",
  }))
  assert.match(html, /기술 소식 제목/)
  assert.match(html, /피드에서 제공한 소개/)
  assert.match(html, /엔지니어링/)
  assert.match(html, /게시·갱신/)
  assert.match(html, /피드가 제공한 게시 또는 갱신 시각, 한국 시간/)
  assert.doesNotMatch(html, /h-40|sm:h-48|<img/)
})