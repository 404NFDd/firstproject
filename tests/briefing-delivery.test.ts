import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, mock, test } from "node:test"
import nodemailer from "nodemailer"
import { prisma } from "../lib/prisma"
import { CURATION_KIND, getCurationHash } from "../lib/news-curation"

let sendDailyBriefing: typeof import("../lib/daily-briefing").sendDailyBriefing
let getBriefingDateKey: typeof import("../lib/daily-briefing").getBriefingDateKey
let markInterruptedBriefings: typeof import("../lib/daily-briefing").markInterruptedBriefings
const originals = { user: prisma.user, news: prisma.news, newsTranslation: prisma.newsTranslation, briefingDelivery: prisma.briefingDelivery }
const env = { SMTP_HOST: process.env.SMTP_HOST, GEMINI_API_KEY: process.env.GEMINI_API_KEY }
const originalTransport = nodemailer.createTransport
let sendMail: (options: { to: string }) => Promise<unknown>
let calls: string[]
type Row = { id: string; userId: string; dateKey: string; status: string; attempts: number; startedAt: Date }
let rows: Map<string, Row>
const users = [{ id: "reader-1", email: "reader1@example.invalid", name: "독자1" }, { id: "reader-2", email: "reader2@example.invalid", name: "독자2" }]

before(async () => {
  nodemailer.createTransport = (() => ({ sendMail: (options: { to: string }) => sendMail(options) })) as never
  const briefingModule = await import("../lib/daily-briefing")
  ;({ sendDailyBriefing, getBriefingDateKey, markInterruptedBriefings } = briefingModule)
})
beforeEach(() => {
  process.env.SMTP_HOST = "local-test-smtp"
  delete process.env.GEMINI_API_KEY
  calls = []
  rows = new Map()
  sendMail = async ({ to }) => { calls.push(to); return { accepted: [to], messageId: "test-message" } }
  Object.defineProperty(prisma, "user", { configurable: true, writable: true, value: { findMany: async ({ where }: { where: { id?: string } }) => where.id ? users.filter((user) => user.id === where.id) : users } })
  Object.defineProperty(prisma, "news", { configurable: true, writable: true, value: { findMany: async () => [{
    id: "news", title: "확인한 기사", description: "실제 소개", content: null,
    category: "100", source: "공식 출처", publishedAt: new Date(),
  }] } })
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, writable: true, value: { findMany: async () => [{
    newsId: "news", kind: CURATION_KIND, status: "ready", sourceHash: getCurationHash({title:"확인한 기사",content:null}),
    translatedText: JSON.stringify({selected:true,title:"확인한 기사",summary:"한국어로 정리한 기사 요약입니다.",highlights:["핵심 내용입니다."],sections:[],reason:"새로운 소식",evidence:[]}),
  }] } })
  Object.defineProperty(prisma, "briefingDelivery", { configurable: true, writable: true, value: {
    create: async ({ data }: { data: { userId: string; dateKey: string } }) => {
      const key = data.userId + data.dateKey
      if (rows.has(key)) throw { code: "P2002" }
      const row = { ...data, id: key, status: "processing", attempts: 1, startedAt: new Date() }
      rows.set(key, row)
      return row
    },
    findUnique: async ({ where }: { where: { userId_dateKey: { userId: string; dateKey: string } } }) =>
      rows.get(where.userId_dateKey.userId + where.userId_dateKey.dateKey),
    updateMany: async ({ where, data }: { where: { userId?: string; dateKey?: string; status: string; startedAt?: { lte: Date }; id?: { in: string[] } }; data: Record<string, unknown> }) => {
      let count = 0
      for (const row of rows.values()) {
        if (row.status !== where.status || (where.userId && row.userId !== where.userId) ||
          (where.dateKey && row.dateKey !== where.dateKey) ||
          (where.startedAt && row.startedAt > where.startedAt.lte) || (where.id && !where.id.in.includes(row.id))) continue
        Object.assign(row, data, { attempts: data.attempts ? row.attempts + 1 : row.attempts })
        count++
      }
      return { count }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...rows.values()].find((row) => row.id === where.id)!
      Object.assign(row, data)
      return row
    },
  } })
  mock.method(console, "log", () => {})
  mock.method(console, "error", () => {})
})
afterEach(() => {
  mock.restoreAll()
  for (const [name, value] of Object.entries(originals)) Object.defineProperty(prisma, name, { configurable: true, writable: true, value })
})
after(() => {
  nodemailer.createTransport = originalTransport
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("정기 브리핑 동시 호출과 같은 날짜 재실행은 사용자별 한 통만 전송한다", async () => {
  const results = await Promise.all([sendDailyBriefing(), sendDailyBriefing(), sendDailyBriefing()])
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 2)
  assert.deepEqual(calls.sort(), users.map((user) => user.email).sort())
  assert.equal((await sendDailyBriefing()).skipped, 2)
  assert.equal(calls.length, 2)
  assert.ok([...rows.values()].every((row) => row.status === "sent"))
})

test("명시적인 SMTP 거절만 재시도하며 성공한 사용자는 다시 보내지 않는다", async () => {
  let reject = true
  sendMail = async ({ to }) => {
    calls.push(to)
    if (to === users[1].email && reject) throw Object.assign(new Error("수신자 거절"), { responseCode: 550, command: "RCPT TO" })
    return { accepted: [to], messageId: "message" }
  }
  const first = await sendDailyBriefing()
  assert.equal(first.sent, 1)
  assert.equal(first.failed, 1)
  reject = false
  const second = await sendDailyBriefing()
  assert.equal(second.sent, 1)
  assert.equal(second.skipped, 1)
  assert.equal(calls.filter((email) => email === users[0].email).length, 1)
  assert.equal([...rows.values()].find((row) => row.userId === users[1].id)?.attempts, 2)
})

test("DATA 후 연결 단절은 결과 확인 필요 상태로 보존하고 자동 재발송하지 않는다", async () => {
  sendMail = async ({ to }) => { calls.push(to); throw Object.assign(new Error("응답 대기 시간 초과"), { code: "ETIMEDOUT", command: "DATA" }) }
  assert.equal((await sendDailyBriefing()).uncertain, 2)
  const retry = await sendDailyBriefing()
  assert.equal(retry.success, false)
  assert.equal(retry.uncertain, 2)
  assert.equal(calls.length, 2)
  assert.ok([...rows.values()].every((row) => row.status === "unknown"))
})

test("SMTP 수락 뒤 DB 기록 실패도 processing 예약을 유지하여 중복 발송하지 않는다", async () => {
  mock.method(prisma.briefingDelivery, "update", async () => { throw new Error("DB 기록 실패") })
  assert.equal((await sendDailyBriefing()).uncertain, 2)
  assert.equal((await sendDailyBriefing()).skipped, 2)
  assert.equal(calls.length, 2)
})

test("중단된 예약은 확인 필요로 전환하며 한국 자정에 날짜 키가 바뀐다", async () => {
  await sendDailyBriefing()
  const row = [...rows.values()][0]
  row.status = "processing"
  row.startedAt = new Date(Date.now() - 31 * 60 * 1000)
  assert.equal((await markInterruptedBriefings()).count, 1)
  assert.equal(row.status, "unknown")
  assert.equal(getBriefingDateKey(new Date("2026-10-01T14:59:59Z")), "2026-10-01")
  assert.equal(getBriefingDateKey(new Date("2026-10-01T15:00:00Z")), "2026-10-02")
})

test("테스트 메일은 정기 발송 기록을 소비하지 않는다", async () => {
  assert.equal((await sendDailyBriefing("reader-1")).sent, 1)
  assert.equal(rows.size, 0)
  assert.equal((await sendDailyBriefing()).sent, 2)
})


test("메일 요청 전 예약 준비가 실패하면 확보한 대상은 재시도 가능한 실패 상태로 해제한다", async () => {
  const create = prisma.briefingDelivery.create.bind(prisma.briefingDelivery)
  let count = 0
  mock.method(prisma.briefingDelivery, "create", async (args: Parameters<typeof create>[0]) => {
    if (++count === 2) throw new Error("예약 저장 실패")
    return create(args)
  })
  const result = await sendDailyBriefing()
  assert.equal(result.success, false)
  assert.equal(result.failed, 1)
  assert.equal(calls.length, 0)
  assert.ok([...rows.values()].every((row) => row.status === "failed"))
})
