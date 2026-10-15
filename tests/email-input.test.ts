import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, mock, test } from "node:test"
import { NextRequest } from "next/server"
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer"
import type { News } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { generateAccessToken } from "../lib/auth"
import { getSafeNewsUrl } from "../lib/news-links"
import { PUBLISHED_SUMMARY_FILTER } from "../lib/news-summary-service"
import { CURATION_KIND, getCurationHash } from "../lib/news-curation"

const previousAccessSecret = process.env.JWT_ACCESS_SECRET
const previousSmtpHost = process.env.SMTP_HOST
process.env.JWT_ACCESS_SECRET = "email-input-tests-access-secret"
process.env.SMTP_HOST = "smtp.invalid"

// 모듈을 불러오기 전에 SMTP 전송기를 대체해 실제 메일 연결을 차단한다.
const sendMail = mock.fn(async (options: SendMailOptions) => {
  assert.ok(options.to)
  return { messageId: "test-message-id" }
})
mock.method(nodemailer, "createTransport", () => ({ sendMail }) as unknown as Transporter)
let sendNews: typeof import("../app/api/news/send-email/route").POST
let subscribe: typeof import("../app/api/email/subscribe/route").POST
let getSubscription: typeof import("../app/api/email/subscribe/route").GET
let accessToken: string

before(async () => {
  const emailRoute = await import("../app/api/news/send-email/route")
  const subscriptionRoute = await import("../app/api/email/subscribe/route")
  sendNews = emailRoute.POST
  subscribe = subscriptionRoute.POST
  getSubscription = subscriptionRoute.GET
  accessToken = await generateAccessToken({ userId: "test-user", email: "user@example.invalid" })
})
const originalUser = prisma.user
const originalNews = prisma.news
const originalTranslations = prisma.newsTranslation
beforeEach(() => {
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, value: { findMany: async () => [] } })
  sendMail.mock.resetCalls()
  // Prisma 프록시는 메서드 descriptor를 제공하지 않으므로 delegate 자체를 모형으로 대체한다.
  Object.defineProperty(prisma, "user", {
    value: { findUnique: unexpectedDatabaseCall, update: unexpectedDatabaseCall },
    writable: true, configurable: true,
  })
  Object.defineProperty(prisma, "news", {
    value: { findMany: unexpectedDatabaseCall },
    writable: true, configurable: true,
  })
})
afterEach(() => {
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, value: originalTranslations })
  Object.defineProperty(prisma, "user", { value: originalUser, writable: true, configurable: true })
  Object.defineProperty(prisma, "news", { value: originalNews, writable: true, configurable: true })
})
after(() => {
  mock.restoreAll()
  if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET
  else process.env.JWT_ACCESS_SECRET = previousAccessSecret
  if (previousSmtpHost === undefined) delete process.env.SMTP_HOST
  else process.env.SMTP_HOST = previousSmtpHost
})

function request(path: string, body: unknown, authenticated = true, raw = false) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Cookie: `accessToken=${accessToken}` } : {}),
    },
    body: raw ? String(body) : JSON.stringify(body),
  })
}

function unexpectedDatabaseCall() {
  throw new Error("잘못된 입력에서 DB를 호출했습니다.")
}

const invalidNewsBodies: unknown[] = [
  null,
  {},
  { newsIds: [] },
  { newsIds: "news-id" },
  { newsIds: [" "] },
  { newsIds: [1] },
  { newsIds: [{ id: "news-id" }] },
  { newsIds: Array.from({ length: 51 }, (_, index) => `news-${index}`) },
  { newsIds: ["news-id"], title: 12 },
  { newsIds: ["news-id"], title: "가".repeat(201) },
]

for (const [index, body] of invalidNewsBodies.entries()) {
  test(`기사 메일의 잘못된 입력 ${index + 1}은 DB와 SMTP 호출 없이 400을 반환한다`, async (context) => {
    const findUser = context.mock.method(prisma.user, "findUnique", unexpectedDatabaseCall)
    const findNews = context.mock.method(prisma.news, "findMany", unexpectedDatabaseCall)
    const response = await sendNews(request("/api/news/send-email", body))
    assert.equal(response.status, 400)
    assert.equal(findUser.mock.callCount(), 0)
    assert.equal(findNews.mock.callCount(), 0)
    assert.equal(sendMail.mock.callCount(), 0)
  })
}

test("기사 메일의 잘못된 JSON은 DB와 SMTP 호출 없이 400을 반환한다", async (context) => {
  const findUser = context.mock.method(prisma.user, "findUnique", unexpectedDatabaseCall)
  const findNews = context.mock.method(prisma.news, "findMany", unexpectedDatabaseCall)
  const response = await sendNews(request("/api/news/send-email", "{", true, true))
  assert.equal(response.status, 400)
  assert.equal(findUser.mock.callCount(), 0)
  assert.equal(findNews.mock.callCount(), 0)
  assert.equal(sendMail.mock.callCount(), 0)
})

for (const [index, body] of [null, {}, { subscribe: "false" }, { subscribe: 0 }, { subscribe: [] }].entries()) {
  test(`구독의 잘못된 입력 ${index + 1}은 구독 상태를 변경하지 않는다`, async (context) => {
    const update = context.mock.method(prisma.user, "update", unexpectedDatabaseCall)
    const response = await subscribe(request("/api/email/subscribe", body))
    assert.equal(response.status, 400)
    assert.equal(update.mock.callCount(), 0)
    assert.equal(sendMail.mock.callCount(), 0)
  })
}

test("구독의 잘못된 JSON은 구독 상태를 변경하지 않는다", async (context) => {
  const update = context.mock.method(prisma.user, "update", unexpectedDatabaseCall)
  const response = await subscribe(request("/api/email/subscribe", "{", true, true))
  assert.equal(response.status, 400)
  assert.equal(update.mock.callCount(), 0)
})

test("로그인하지 않은 메일 및 구독 요청은 401을 반환한다", async (context) => {
  const findUser = context.mock.method(prisma.user, "findUnique", unexpectedDatabaseCall)
  const findNews = context.mock.method(prisma.news, "findMany", unexpectedDatabaseCall)
  const update = context.mock.method(prisma.user, "update", unexpectedDatabaseCall)
  assert.equal((await sendNews(request("/api/news/send-email", { newsIds: ["news-id"] }, false))).status, 401)
  assert.equal((await subscribe(request("/api/email/subscribe", { subscribe: true }, false))).status, 401)
  assert.equal((await getSubscription(new NextRequest("http://localhost/api/email/subscribe"))).status, 401)
  assert.equal(findUser.mock.callCount(), 0)
  assert.equal(findNews.mock.callCount(), 0)
  assert.equal(update.mock.callCount(), 0)
  assert.equal(sendMail.mock.callCount(), 0)
})

test("명시적인 false 값만 구독을 해제한다", async (context) => {
  const update = context.mock.method(prisma.user, "update", (() => Promise.resolve({
    id: "test-user", email: "user@example.invalid", emailSubscription: 0,
  })) as unknown as typeof prisma.user.update)
  const response = await subscribe(request("/api/email/subscribe", { subscribe: false }))
  assert.equal(response.status, 200)
  assert.deepEqual(update.mock.calls[0].arguments[0], {
    where: { id: "test-user" },
    data: { emailSubscription: 0 },
    select: { id: true, email: true, emailSubscription: true },
  })
  assert.equal(sendMail.mock.callCount(), 0)
})

test("기사 메일은 ID 중복을 제거하고 HTML을 이스케이프하며 SMTP 모형에만 전달한다", async (context) => {
  const article: News = {
    id: "news-a", title: "<script>제목</script>", description: "설명 & 내용", content: null,
    imageUrl: null, sourceUrl: null, source: "출처", author: null,
    publishedAt: new Date("2026-10-01T00:00:00Z"), category: "100", priority: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"),
  }
  context.mock.method(prisma.user, "findUnique", (() => Promise.resolve({
    email: "user@example.invalid",
  })) as unknown as typeof prisma.user.findUnique)
  const findNews = context.mock.method(prisma.news, "findMany", (() => Promise.resolve([article])) as unknown as typeof prisma.news.findMany)
  const response = await sendNews(request("/api/news/send-email", {
    newsIds: ["news-a", " news-a ", "news-b"], title: "  공유 제목  ",
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(findNews.mock.calls[0].arguments[0], { where: { source: { notIn: ["GeekNews", "Hacker News"] }, ...PUBLISHED_SUMMARY_FILTER, id: { in: ["news-a", "news-b"] } } })
  assert.equal(sendMail.mock.callCount(), 1)
  const mail = sendMail.mock.calls[0].arguments[0] as SendMailOptions
  assert.equal(mail.to, "user@example.invalid")
  assert.equal(mail.subject, "공유 제목")
  assert.match(String(mail.html), /&lt;script&gt;제목&lt;\/script&gt;/)
  assert.doesNotMatch(String(mail.html), /<script>/)
})

test("기사 원문 URL은 절대 웹 주소만 허용하고 스크립트·상대경로·자격증명을 거부한다", () => {
  assert.equal(getSafeNewsUrl(" https://example.com/news?a=1&b=2 "), "https://example.com/news?a=1&b=2")
  for (const url of [null, "", "/news/1", "//example.com", "javascript:alert(1)", "data:text/html,test", "https://reader:secret@example.com/news"]) {
    assert.equal(getSafeNewsUrl(url), null)
  }
})

test("선택 기사 메일은 한국어 요약을 제공하고 원문 발췌를 제외하며 출처와 한국 시각을 담는다", async (context) => {
  const article: News = {
    id: "news-a", title: "Node.js &amp; 도구", description: "버전 변경 안내", content: null,
    imageUrl: null, sourceUrl: "https://example.com/news?a=1&b=2", source: "공식 &amp; 발표", author: null,
    publishedAt: new Date("2026-09-30T16:00:00Z"), category: "105", priority: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"),
  }
  context.mock.method(prisma.user, "findUnique", (() => Promise.resolve({ email: "user@example.invalid" })) as unknown as typeof prisma.user.findUnique)
  const articles = [
    article, { ...article, id: "news-b", title: "제목만 있는 기사", description: null, sourceUrl: "javascript:alert(1)" },
    { ...article, id: "news-c", description: null, content: "본문의 첫 문장", sourceUrl: null },
    { ...article, id: "news-d", category: "engineering", sourceUrl: "https://d2.naver.com/helloworld/123" },
  ]
  context.mock.method(prisma.news, "findMany", (() => Promise.resolve(articles)) as unknown as typeof prisma.news.findMany)
  context.mock.method(prisma.newsTranslation,"findMany",async()=>[articles[0],articles[3]].map((item)=>({newsId:item.id,kind:CURATION_KIND,status:"ready",sourceHash:getCurationHash(item),translatedText:JSON.stringify({selected:true,title:"한국어로 정리한 제품 소식",summary:"한국어로 정리한 요약입니다.",highlights:["한국어 핵심 내용"],sections:[],reason:"제품 발표",evidence:[]})})) as never)
  const response = await sendNews(request("/api/news/send-email", { newsIds: ["news-a", "news-b", "news-c", "news-d"] }))
  assert.equal(response.status, 200)
  const html = String(sendMail.mock.calls[0].arguments[0].html)
  assert.match(html, /IT·과학 · AI 요약/)
  assert.match(html, /엔지니어링 · AI 요약/)
  assert.match(html, /게시·갱신:/)
  assert.match(html, />출처에서 읽기<\/a>/)
  assert.match(html, /제목만 제공/)
  assert.match(html, /한국어로 정리한 요약입니다/)
  assert.match(html, /href="https:\/\/example\.com\/news\?a=1&amp;b=2"/)
  assert.match(html, /2026년 10월 1일/)
  assert.match(html, /한국 시간/)
  assert.match(html, /원문 링크를 확인할 수 없습니다/)
  assert.doesNotMatch(html, /javascript:|&amp;amp;|원문 발췌|본문 발췌|본문의 첫 문장|버전 변경 안내/)
})
