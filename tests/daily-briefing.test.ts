import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { generateAccessToken } from "../lib/auth"
import { POST as testBriefingRoute } from "../app/api/email/test-briefing/route"
import { getDailyNews, sendDailyBriefing } from "../lib/daily-briefing"
import { POST as dailyBriefingRoute } from "../app/api/email/daily-briefing/route"

const originalUser = prisma.user
const originalNews = prisma.news
const originalDelivery = prisma.briefingDelivery
const originalSecret = process.env.CRON_SECRET
let userQueries: unknown[]
let newsQueries: unknown[]
beforeEach(() => {
  Object.defineProperty(prisma, "briefingDelivery", { value: { updateMany: async () => ({ count: 0 }) }, configurable: true, writable: true })
  userQueries = []
  newsQueries = []
  Object.defineProperty(prisma, "user", { value: { findMany: async (args: unknown) => { userQueries.push(args); return [] } }, writable: true, configurable: true })
  Object.defineProperty(prisma, "news", { value: { findMany: async (args: unknown) => { newsQueries.push(args); return [] } }, writable: true, configurable: true })
  mock.method(console, "log", () => {})
})
afterEach(() => {
  mock.restoreAll()
  Object.defineProperty(prisma, "briefingDelivery", { value: originalDelivery, configurable: true, writable: true })
  Object.defineProperty(prisma, "user", { value: originalUser, writable: true, configurable: true })
  Object.defineProperty(prisma, "news", { value: originalNews, writable: true, configurable: true })
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

test("브리핑은 자정 기준이 아닌 지난 24시간 뉴스와 미래 시각 제외 조건을 조회한다", async () => {
  const before = Date.now()
  await getDailyNews()
  const args = newsQueries[0] as { where: { publishedAt: { gte: Date; lte: Date } }; take: number; orderBy: unknown[] }
  const { gte, lte } = args.where.publishedAt
  assert.equal(lte.getTime() - gte.getTime(), 24 * 60 * 60 * 1000)
  assert.ok(lte.getTime() >= before && lte.getTime() <= Date.now())
  assert.deepEqual((args.where as unknown as { source: unknown }).source, { notIn: ["GeekNews", "Hacker News"] })
  assert.equal(args.take, 50)
  assert.deepEqual(args.orderBy, [{ priority: "desc" }, { publishedAt: "desc" }])
})

test("구독자 0명일 때 집계를 완전하게 반환하고 뉴스·메일 요청을 생략한다", async () => {
  const result = await sendDailyBriefing()
  assert.deepEqual(result, { success: true, sent: 0, failed: 0, total: 0, skipped: 0, uncertain: 0 })
  assert.deepEqual((userQueries[0] as { where: unknown }).where, { emailSubscription: 1 })
  assert.equal(newsQueries.length, 0)
})

test("테스트 브리핑은 대상 한 명만 선택하고 구독 상태를 수정하지 않는다", async () => {
  mock.method(prisma.user, "findMany", async (args: unknown) => { userQueries.push(args); return [{ id: "user-1", email: "user@example.com", name: "사용자" }] })
  const result = await sendDailyBriefing("user-1")
  assert.deepEqual((userQueries[0] as { where: unknown }).where, { id: "user-1" })
  assert.deepEqual(result, { success: true, sent: 0, failed: 0, total: 1, skipped: 1, uncertain: 0 })
})

test("Cron 비밀값을 설정하지 않으면 전체 구독자 브리핑을 실행하지 않는다", async () => {
  delete process.env.CRON_SECRET
  const response = await dailyBriefingRoute(new NextRequest("http://localhost/api/email/daily-briefing", { method: "POST" }))
  assert.equal(response.status, 401)
  assert.deepEqual(userQueries, [])
  assert.deepEqual(newsQueries, [])
})

test("뉴스가 없는 테스트 브리핑은 API에도 실제 전송 0건과 생략 건수를 반환한다", async () => {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET
  process.env.JWT_ACCESS_SECRET = "test-briefing-secret"
  try {
    const user = { id: "user-1", email: "user@example.com", name: "사용자" }
    Object.defineProperty(prisma.user, "findUnique", { value: mock.fn(async () => user), configurable: true, writable: true })
    mock.method(prisma.user, "findMany", async () => [user])
    const token = await generateAccessToken({ userId: user.id, email: user.email })
    const response = await testBriefingRoute(new NextRequest("http://localhost/api/email/test-briefing", { method: "POST", headers: { Cookie: `accessToken=${token}` } }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.sent, 0)
    assert.equal(body.skipped, 1)
    assert.match(body.message, /발송을 생략/)
  } finally {
    if (originalAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET
    else process.env.JWT_ACCESS_SECRET = originalAccessSecret
  }
})
