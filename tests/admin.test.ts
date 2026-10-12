import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import bcrypt from "bcryptjs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { generateAccessToken } from "../lib/auth"
import { getAdminAccess, syncAdminAccount } from "../lib/admin"
import { GET as getDashboard } from "../app/api/admin/dashboard/route"
import { POST as syncNews } from "../app/api/news/sync/route"
import { loginSchema, registerSchema } from "../lib/auth-validation"

const originalDelegates = { user: prisma.user, news: prisma.news, newsSyncLog: prisma.newsSyncLog, briefingDelivery: prisma.briefingDelivery, newsTranslation: prisma.newsTranslation }
const unexpected = async () => { throw new Error("정의되지 않은 DB 접근") }
const oldAccessSecret = process.env.JWT_ACCESS_SECRET
const oldNextSecret = process.env.NEXTAUTH_SECRET
beforeEach(() => {
  for (const name of ["user", "news", "newsSyncLog", "briefingDelivery", "newsTranslation"] as const) {
    Object.defineProperty(prisma, name, { value: { findUnique: unexpected, findMany: unexpected, findFirst: unexpected, create: unexpected, update: unexpected, count: unexpected, deleteMany: unexpected, updateMany: async () => ({ count: 0 }), groupBy: async () => [] }, configurable: true, writable: true })
  }
  process.env.JWT_ACCESS_SECRET = "test-admin-access-secret"
  delete process.env.NEXTAUTH_SECRET
})
afterEach(() => {
  mock.restoreAll()
  for (const name of ["user", "news", "newsSyncLog", "briefingDelivery", "newsTranslation"] as const) Object.defineProperty(prisma, name, { value: originalDelegates[name], configurable: true, writable: true })
  if (oldAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET
  else process.env.JWT_ACCESS_SECRET = oldAccessSecret
  if (oldNextSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = oldNextSecret
})
async function request(path: string, body?: unknown) {
  const token = await generateAccessToken({ userId: "test-user", email: "user@example.invalid", isAdmin: true })
  return new NextRequest("http://localhost" + path, { method: body ? "POST" : "GET", headers: { Cookie: `accessToken=${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
}

test("미로그인 관리자 조회는 회원 DB를 읽지 않고 401을 반환한다", async () => {
  const lookup = mock.method(prisma.user, "findUnique", async () => { throw new Error("DB 접근 금지") })
  assert.equal((await getDashboard(new NextRequest("http://localhost/api/admin/dashboard"))).status, 401)
  assert.equal(lookup.mock.callCount(), 0)
})
test("JWT 관리자 주장을 신뢰하지 않고 DB가 일반 회원이면 403으로 차단한다", async () => {
  mock.method(prisma.user, "findUnique", async () => ({ isAdmin: false }) as never)
  const list = mock.method(prisma.user, "findMany", async () => { throw new Error("회원 목록 접근 금지") })
  assert.equal((await getDashboard(await request("/api/admin/dashboard"))).status, 403)
  assert.equal(list.mock.callCount(), 0)
})
test("DB에서 제거된 관리자도 접근을 차단한다", async () => {
  mock.method(prisma.user, "findUnique", async () => null)
  assert.equal((await getAdminAccess(await request("/api/admin/dashboard"))).allowed, false)
})
test("관리자 회원 조회는 개인정보 필드를 제한하고 페이지와 통계를 반환한다", async () => {
  mock.method(prisma.user, "findUnique", async () => ({ isAdmin: true }) as never)
  mock.method(prisma.user, "count", async () => 21)
  mock.method(prisma.news, "count", async () => 10)
  const users = mock.method(prisma.user, "findMany", async () => [{ id: "member", email: "reader@example.invalid", name: "독자", emailSubscription: 0, createdAt: new Date() }] as never)
  mock.method(prisma.newsSyncLog, "findMany", async () => [])
  mock.method(prisma.briefingDelivery, "findMany", async () => [])
  const response = await getDashboard(await request("/api/admin/dashboard?page=2"))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  const body = await response.json()
  assert.equal(body.pagination.pages, 2)
  const args = users.mock.calls[0].arguments[0]!
  assert.equal(args.skip, 20)
  assert.deepEqual(args.where, { isAdmin: false })
  assert.deepEqual(args.select, { id: true, name: true, email: true, emailSubscription: true, createdAt: true })
  assert.doesNotMatch(JSON.stringify(body), /password|refreshToken|adminUsername/)
})
test("관리자 조회의 잘못된 페이지는 목록을 읽지 않고 거절한다", async () => {
  mock.method(prisma.user, "findUnique", async () => ({ isAdmin: true }) as never)
  const users = mock.method(prisma.user, "findMany", async () => { throw new Error("목록 접근 금지") })
  assert.equal((await getDashboard(await request("/api/admin/dashboard?page=0"))).status, 400)
  assert.equal(users.mock.callCount(), 0)
})
test("관리자 아이디 로그인은 허용하되 회원가입에는 이메일만 허용한다", () => {
  assert.equal(loginSchema.safeParse({ email: "admin", password: "secret" }).success, true)
  assert.equal(registerSchema.safeParse({ email: "admin", password: "secret", isAdmin: true }).success, false)
  assert.deepEqual(registerSchema.parse({ email: "user@example.invalid", password: "secret", isAdmin: true, adminUsername: "admin" }), { email: "user@example.invalid", password: "secret" })
})
const config = { ADMIN_ID: "admin", ADMIN_PASSWORD: "strong-admin-password-123", ADMIN_EMAIL: "admin@example.invalid" }

test("환경 설정 관리자를 DB에 생성할 때 비밀번호 원문을 저장하지 않는다", async () => {
  let data: Record<string, unknown> = {}
  mock.method(prisma, "$transaction", (async (callback: (tx: unknown) => unknown) => callback({ user: { findUnique: async () => null, create: async (args: { data: Record<string, unknown> }) => { data = args.data } } })) as never)
  assert.equal((await syncAdminAccount(config)).created, true)
  assert.equal(data.adminUsername, "admin")
  assert.equal(data.isAdmin, true)
  assert.notEqual(data.password, config.ADMIN_PASSWORD)
  assert.equal(await bcrypt.compare(config.ADMIN_PASSWORD, String(data.password)), true)
})
test("관리자 설정 재동기화는 기존 계정을 유지하고 같은 비밀번호 해시를 재사용한다", async () => {
  const password = await bcrypt.hash(config.ADMIN_PASSWORD, 4)
  let data: Record<string, unknown> = {}
  const existing = { id: "admin-user", isAdmin: true, password }
  const revoke = mock.fn(async () => ({}))
  mock.method(prisma, "$transaction", (async (callback: (tx: unknown) => unknown) => callback({ user: { findUnique: async () => existing, update: async (args: { data: Record<string, unknown> }) => { data = args.data } }, refreshToken: { deleteMany: revoke } })) as never)
  assert.equal((await syncAdminAccount(config)).created, false)
  assert.equal(data.password, password)
  assert.equal(revoke.mock.callCount(), 0)
})
test("관리자 이메일이 일반 회원과 겹치면 계정 변경 없이 중단한다", async () => {
  const update = mock.fn(async () => ({}))
  mock.method(prisma, "$transaction", (async (callback: (tx: unknown) => unknown) => callback({ user: { findUnique: async ({ where }: { where: { email?: string } }) => where.email ? { id: "member", isAdmin: false } : null, update } })) as never)
  await assert.rejects(syncAdminAccount(config), /일반 회원과 겹칩니다/)
  assert.equal(update.mock.callCount(), 0)
})
test("관리자 비밀번호가 없거나 bcrypt 한도를 넘으면 DB 접근 없이 중단한다", async () => {
  const tx = mock.method(prisma, "$transaction", async () => { throw new Error("DB 접근 금지") })
  await assert.rejects(syncAdminAccount({ ...config, ADMIN_PASSWORD: "" }))
  await assert.rejects(syncAdminAccount({ ...config, ADMIN_PASSWORD: "가".repeat(25) }))
  assert.equal(tx.mock.callCount(), 0)
})

async function installReservation(admin: boolean, status: string) {
  mock.method(prisma.user, "findUnique", async () => ({ isAdmin: admin }) as never)
  let reservationWhere: unknown
  const tx = { newsSyncLog: {
    findFirst: async ({ where }: { where: { OR: { status: string | { in: string[] } }[] } }) => {
      reservationWhere = where
      return status === "processing" || where.OR.some((entry) => typeof entry.status === "object") ? { status, createdAt: new Date() } : null
    }, create: async () => ({ id: "log" }),
  } }
  mock.method(prisma, "$transaction", (async (callback: (value: unknown) => unknown) => callback(tx)) as never)
  mock.method(prisma.newsSyncLog, "update", async () => ({}) as never)
  mock.method(prisma.news, "findFirst", async () => null)
  mock.method(prisma.news, "create", async () => ({id:"admin-news-fixture"}) as never)
  mock.method(prisma.newsTranslation, "deleteMany", async () => ({count:0}))
  mock.method(prisma.newsTranslation, "findMany", async () => [])
  Object.defineProperty(prisma.newsTranslation, "createMany", { configurable: true, value: async () => ({count:1}) })
  const fetcher = mock.method(globalThis, "fetch", async (url: string | URL | Request) => new Response(String(url).includes("/section/")
    ? '<a class="sa_text_title" href="https://n.news.naver.com/mnews/article/001/0001">뉴스</a>'
    : '<span data-date-time="2026-10-01 00:30:00"></span><div id="dic_area">확인된 기사 본문</div>'))
  return { fetcher, where: () => reservationWhere }
}
test("일반 회원은 force·admin 요청값을 보내도 1시간 제한을 우회할 수 없다", async () => {
  const state = await installReservation(false, "success")
  const response = await syncNews(await request("/api/news/sync", { categories: ["105"], limitPerCategory: 1, force: true, admin: true }))
  assert.equal(response.status, 429)
  assert.equal(state.fetcher.mock.callCount(), 0)
})
test("관리자는 최근 성공한 수집 이후에도 다시 수집할 수 있다", async () => {
  const state = await installReservation(true, "success")
  const response = await syncNews(await request("/api/news/sync", { categories: ["105"], limitPerCategory: 1 }))
  assert.equal(response.status, 200)
  assert.deepEqual(state.where(), { OR: [{ status: "processing", createdAt: { gte: (state.where() as { OR: { createdAt: { gte: Date } }[] }).OR[0].createdAt.gte } }] })
  assert.equal(state.fetcher.mock.callCount(), 2)
})
test("관리자도 진행 중인 수집의 중복 실행은 할 수 없다", async () => {
  const state = await installReservation(true, "processing")
  assert.equal((await syncNews(await request("/api/news/sync", { categories: ["105"], limitPerCategory: 1 }))).status, 429)
  assert.equal(state.fetcher.mock.callCount(), 0)
})


test("관리자 응답은 오늘의 브리핑 상태 집계와 출처별 수집 결과를 보존한다", async () => {
  mock.method(prisma.user, "findUnique", async () => ({ isAdmin: true }) as never)
  mock.method(prisma.user, "count", async () => 0)
  mock.method(prisma.news, "count", async () => 0)
  mock.method(prisma.user, "findMany", async () => [])
  const sourceReports = [{ id: "source", name: "공식 출처", status: "partial", received: 2, accepted: 1, excluded: 1, reasons: { missing_content: 1 }, durationMs: 80 }]
  mock.method(prisma.newsSyncLog, "findMany", async () => [{ id: "log", createdCount: 1, sourceReports }] as never)
  mock.method(prisma.briefingDelivery, "findMany", async () => [])
  const grouping = mock.method(prisma.briefingDelivery, "groupBy", async () => [
    { status: "sent", _count: { _all: 2 } }, { status: "unknown", _count: { _all: 1 } },
  ] as never)
  const response = await getDashboard(await request("/api/admin/dashboard"))
  const body = await response.json()
  assert.deepEqual(body.briefing.counts, { sent: 2, unknown: 1 })
  assert.equal(body.syncLogs[0].createdCount, 1)
  assert.deepEqual(body.syncLogs[0].sourceReports, sourceReports)
  assert.equal((grouping.mock.calls[0].arguments[0] as { where: { dateKey: string } }).where.dateKey, body.briefing.dateKey)
})
