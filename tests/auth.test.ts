import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { SignJWT } from "jose"
import { encode } from "next-auth/jwt"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { generateAccessToken, generateRefreshToken, issueSessionTokens, hashRefreshToken, verifyAccessToken, verifyRefreshToken } from "../lib/auth"
import { getRequestUser } from "../lib/request-auth"
import { loginSchema, registerSchema, profileSchema } from "../lib/auth-validation"
import { authOptions } from "../lib/auth-options"
import { POST as login } from "../app/api/auth/login/route"
import { POST as register } from "../app/api/auth/register/route"
import { POST as logout } from "../app/api/auth/logout/route"
import { POST as refresh } from "../app/api/auth/refresh/route"
import { PUT as updateProfile } from "../app/api/auth/profile/route"

const require = createRequire(import.meta.url)
const nextHeaders = require("next/headers") as typeof import("next/headers")
const user = { id: "test-user", email: "test@example.com" }
const envNames = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "VERCEL"] as const
let savedEnv: Map<string, string | undefined>
const restoreDatabaseMethods: Array<() => void> = []

beforeEach(() => {
  savedEnv = new Map(envNames.map((name) => [name, process.env[name]]))
  process.env.JWT_ACCESS_SECRET = "access-secret-only-for-unit-tests"
  process.env.JWT_REFRESH_SECRET = "refresh-secret-only-for-unit-tests"
  process.env.NEXTAUTH_SECRET = "nextauth-secret-only-for-unit-tests"
  process.env.NEXTAUTH_URL = "http://localhost:3000"
  delete process.env.VERCEL
})

afterEach(() => {
  mock.restoreAll()
  for (const restore of restoreDatabaseMethods.splice(0).reverse()) restore()
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function request(body: unknown, cookie = "") {
  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  })
}

function mockDatabaseMethod(target: object, name: string, implementation: (...args: unknown[]) => unknown) {
  const delegate = target as Record<string, unknown>
  const original = delegate[name]
  const mocked = mock.fn(implementation)
  Object.defineProperty(target, name, { value: mocked, writable: true, configurable: true })
  restoreDatabaseMethods.push(() => Object.defineProperty(target, name, { value: original, writable: true, configurable: true }))
  return mocked
}
function mockCookies(names: string[] = []) {
  const written: string[] = []
  const values = new Map<string, string>()
  const deleted: string[] = []
  mock.method(nextHeaders, "cookies", async () => ({
    set: (name: string, value: string) => { written.push(name); values.set(name, value) },
    delete: (name: string) => deleted.push(name),
    getAll: () => names.map((name) => ({ name, value: "cookie" })),
  }) as unknown as Awaited<ReturnType<typeof nextHeaders.cookies>>)
  return { written, deleted, values }
}

test("인증 입력은 잘못된 타입을 거부하고 이메일·이름 공백만 정리한다", () => {
  assert.equal(loginSchema.safeParse({ email: [], password: 42 }).success, false)
  assert.equal(loginSchema.safeParse({ email: "bad email", password: "x" }).success, false)
  assert.equal(registerSchema.safeParse({ ...user, password: "x", name: {} }).success, false)
  assert.equal(profileSchema.safeParse({ name: "   " }).success, false)
  assert.deepEqual(loginSchema.parse({ email: " test@example.com ", password: " x " }), {
    email: user.email, password: " x ",
  })
})

test("로그인·회원가입의 잘못된 JSON과 타입은 DB 호출 전에 400으로 응답한다", async () => {
  const db = mockDatabaseMethod(prisma.user, "findUnique", async () => { throw new Error("DB 호출 금지") })
  for (const handler of [login, register]) {
    const malformed = new NextRequest("http://localhost:3000/api/auth", { method: "POST", body: "{" })
    assert.equal((await handler(malformed)).status, 400)
    assert.equal((await handler(request({ email: {}, password: [] }))).status, 400)
  }
  assert.equal(db.mock.callCount(), 0)
})

test("회원가입 중 이메일 중복 경쟁도 409로 응답한다", async () => {
  mockDatabaseMethod(prisma.user, "findUnique", async () => null)
  mockDatabaseMethod(prisma.user, "create", async () => {
    throw new Prisma.PrismaClientKnownRequestError("중복", { code: "P2002", clientVersion: "5.21.1" })
  })
  const response = await register(request({ email: user.email, password: "test-password" }))
  assert.equal(response.status, 409)
})

test("JWT는 용도별 서명을 검증하며 같은 사용자도 고유한 갱신 토큰을 받는다", async () => {
  const payload = { userId: user.id, email: user.email }
  const [access, first, second] = await Promise.all([
    generateAccessToken(payload), generateRefreshToken(payload), generateRefreshToken(payload),
  ])
  assert.equal((await verifyAccessToken(access))?.userId, user.id)
  assert.equal((await verifyRefreshToken(first))?.userId, user.id)
  assert.notEqual(first, second)
  assert.equal(await verifyAccessToken(first), null)
  assert.equal(await verifyRefreshToken(access), null)
  assert.equal(await verifyAccessToken(`${access}broken`), null)
})

test("만료되었거나 만료시각이 없는 JWT는 인증에 사용하지 않는다", async () => {
  const signingKey = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)
  const expired = await new SignJWT({ userId: user.id, email: user.email, tokenType: "access" })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime(-1).sign(signingKey)
  const noExpiry = await new SignJWT({ userId: user.id, email: user.email, tokenType: "access" })
    .setProtectedHeader({ alg: "HS256" }).sign(signingKey)
  assert.equal(await verifyAccessToken(expired), null)
  assert.equal(await verifyAccessToken(noExpiry), null)
})

test("유효한 직접 로그인 쿠키와 NextAuth 세션 모두 보호 API에서 인증된다", async () => {
  const access = await generateAccessToken({ userId: user.id, email: user.email })
  assert.deepEqual(await getRequestUser(request({}, `accessToken=${access}`)), { userId: user.id, email: user.email })
  const session = await encode({ token: { id: user.id, email: user.email }, secret: process.env.NEXTAUTH_SECRET! })
  assert.deepEqual(await getRequestUser(request({}, `accessToken=expired; next-auth.session-token=${session}`)), {
    userId: user.id, email: user.email,
  })
})

test("없는·변조된·만료된 NextAuth 세션과 사용자 식별이 없는 세션은 거부한다", async () => {
  assert.equal(await getRequestUser(request({})), null)
  assert.equal(await getRequestUser(request({}, "next-auth.session-token=broken")), null)
  for (const options of [{ token: { id: user.id, email: user.email }, maxAge: -1 }, { token: { email: user.email }, maxAge: 60 }]) {
    const session = await encode({ ...options, secret: process.env.NEXTAUTH_SECRET! })
    assert.equal(await getRequestUser(request({}, `next-auth.session-token=${session}`)), null)
  }
})

test("NextAuth 콜백은 과거에 복사한 토큰을 정리하고 브라우저 세션에 노출하지 않는다", async () => {
  const callbacks = authOptions.callbacks!
  const token = await callbacks.jwt!({
    token: { id: user.id, email: user.email, accessToken: "old-access", refreshToken: "old-refresh" },
    user, account: null,
  })
  assert.equal("accessToken" in token, false)
  assert.equal("refreshToken" in token, false)
  const session = await callbacks.session!({
    session: { user, expires: new Date(Date.now() + 60_000).toISOString() },
    token, user: { ...user, emailVerified: null }, newSession: undefined, trigger: "update",
  })
  assert.equal("accessToken" in session, false)
  assert.equal("refreshToken" in session, false)
  assert.equal(session.user?.email, user.email)
})

test("동일 갱신 토큰의 동시 요청은 한 번만 교체하고 성공한 요청만 쿠키를 설정한다", async () => {
  let available = true
  const created: unknown[] = []
  const deleted: unknown[] = []
  const tx = {
    refreshToken: {
      deleteMany: async (args: { where: { token: { in: string[] }; userId: string; expiresAt: { gt: Date } } }) => {
        deleted.push(args.where)
        const count = available ? 1 : 0
        available = false
        return { count }
      },
      create: async (args: unknown) => { created.push(args); return {} },
    },
  }
  const transaction = mock.method(prisma, "$transaction", (async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
    callback(tx as unknown as Prisma.TransactionClient)) as typeof prisma.$transaction)
  const cookies = mockCookies()
  const results = await Promise.all([issueSessionTokens(user, "old-token"), issueSessionTokens(user, "old-token")])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(results.filter((result) => result === null).length, 1)
  assert.equal(transaction.mock.callCount(), 2)
  assert.equal(created.length, 1)
  assert.deepEqual(cookies.written, ["accessToken", "refreshToken"])
  for (const value of deleted) {
    assert.deepEqual(value, { token: { in: [hashRefreshToken("old-token"), "old-token"] }, userId: user.id, expiresAt: { gt: (value as { expiresAt: { gt: Date } }).expiresAt.gt } })
    assert.ok((value as { expiresAt: { gt: Date } }).expiresAt.gt instanceof Date)
  }
})

test("DB에서 새 토큰 저장에 실패하면 인증 쿠키를 발급하지 않는다", async () => {
  const tx = { refreshToken: {
    deleteMany: async () => ({ count: 1 }),
    create: async () => { throw new Error("저장 실패") },
  } }
  mock.method(prisma, "$transaction", (async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
    callback(tx as unknown as Prisma.TransactionClient)) as typeof prisma.$transaction)
  const cookies = mockCookies()
  await assert.rejects(issueSessionTokens(user), /저장 실패/)
  assert.deepEqual(cookies.written, [])
})

test("프로필은 인증 후에도 잘못된 이름을 DB 업데이트 전에 거부한다", async () => {
  const access = await generateAccessToken({ userId: user.id, email: user.email })
  const db = mockDatabaseMethod(prisma.user, "update", async () => { throw new Error("DB 호출 금지") })
  const response = await updateProfile(request({ name: {} }, `accessToken=${access}`))
  assert.equal(response.status, 400)
  assert.equal(db.mock.callCount(), 0)
})

test("DB 오류가 나도 로그아웃은 브라우저의 인증 쿠키를 제거한다", async () => {
  const access = await generateAccessToken({ userId: user.id, email: user.email })
  mockDatabaseMethod(prisma.refreshToken, "deleteMany", async () => { throw new Error("테스트 DB 장애") })
  mock.method(console, "error", () => {})
  const cookies = mockCookies()
  assert.equal((await logout(request({}, `accessToken=${access}`))).status, 500)
  assert.deepEqual(cookies.deleted, ["accessToken", "refreshToken"])
})

test("잘못된 토큰 만료 설정은 조용히 사용하지 않고 시작 시 검증한다", () => {
  for (const invalid of ["-1", "0", "1.5", "invalid"]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", 'import "./lib/auth.ts"'], {
      cwd: process.cwd(), env: { ...process.env, JWT_ACCESS_EXPIRES_IN: invalid }, encoding: "utf8",
    })
    assert.notEqual(child.status, 0)
    assert.match(child.stderr, /JWT_ACCESS_EXPIRES_IN/)
  }
})

test("같은 서명 비밀값을 사용해도 액세스·갱신 토큰 용도는 서로 바꿀 수 없다", async () => {
  process.env.JWT_REFRESH_SECRET = process.env.JWT_ACCESS_SECRET
  const payload = { userId: user.id, email: user.email }
  const [access, refresh] = await Promise.all([generateAccessToken(payload), generateRefreshToken(payload)])
  assert.equal((await verifyAccessToken(access))?.userId, user.id)
  assert.equal((await verifyRefreshToken(refresh))?.userId, user.id)
  assert.equal(await verifyAccessToken(refresh), null)
  assert.equal(await verifyRefreshToken(access), null)
})

test("로그아웃 API 단독 호출도 모든 NextAuth 세션 조각을 지워 보호 API 인증을 해제한다", async () => {
  const session = await encode({ token: { id: user.id, email: user.email }, secret: process.env.NEXTAUTH_SECRET! })
  const sessionNames = [
    "next-auth.session-token", "next-auth.session-token.0", "next-auth.session-token.1",
    "__Secure-next-auth.session-token", "__Secure-next-auth.session-token.0", "__Secure-next-auth.session-token.12",
  ]
  const cookies = mockCookies([...sessionNames, "analytics", "next-auth.csrf-token"])
  const beforeCookie = `next-auth.session-token=${session}`
  assert.deepEqual(await getRequestUser(request({}, beforeCookie)), { userId: user.id, email: user.email })
  assert.equal((await logout(request({}, beforeCookie))).status, 200)
  for (const name of sessionNames) assert.ok(cookies.deleted.includes(name))
  assert.equal(cookies.deleted.includes("analytics"), false)
  assert.equal(cookies.deleted.includes("next-auth.csrf-token"), false)
  const afterCookie = beforeCookie.split("; ").filter((entry) => !cookies.deleted.includes(entry.split("=")[0])).join("; ")
  assert.equal(await getRequestUser(request({}, afterCookie)), null)
})


test("프로필 세션 갱신은 클라이언트의 ID·이름 대신 로그인한 사용자의 DB 이름을 사용한다", async () => {
  const lookup = mockDatabaseMethod(prisma.user, "findUnique", async () => ({ name: "DB에 저장한 이름" }))
  const token = await authOptions.callbacks!.jwt!({
    token: { id: user.id, email: user.email, name: "이전 이름", accessToken: "old-access", refreshToken: "old-refresh" },
    user: undefined as never,
    account: null,
    trigger: "update",
    session: { id: "other-user", name: "클라이언트가 보낸 이름", email: "other@example.com" },
  })

  assert.deepEqual(lookup.mock.calls[0].arguments[0], { where: { id: user.id }, select: { name: true } })
  assert.equal(token.id, user.id)
  assert.equal(token.email, user.email)
  assert.equal(token.name, "DB에 저장한 이름")
  assert.equal("accessToken" in token, false)
  assert.equal("refreshToken" in token, false)
  const session = await authOptions.callbacks!.session!({
    session: { user, expires: new Date(Date.now() + 60_000).toISOString() },
    token, user: { ...user, emailVerified: null }, newSession: undefined, trigger: "update",
  })
  assert.equal(session.user?.name, "DB에 저장한 이름")
})

test("일반 세션 조회와 사용자 식별자가 없는 갱신은 이름 DB 조회를 실행하지 않는다", async () => {
  const lookup = mockDatabaseMethod(prisma.user, "findUnique", async () => { throw new Error("DB 조회 금지") })
  const regular = await authOptions.callbacks!.jwt!({
    token: { id: user.id, name: "기존 이름" }, user: undefined as never, account: null,
  })
  const unidentified = await authOptions.callbacks!.jwt!({
    token: { name: "기존 이름" }, user: undefined as never, account: null, trigger: "update",
    session: { id: "other-user", name: "주입한 이름" },
  })
  assert.equal(regular.name, "기존 이름")
  assert.equal(unidentified.id, undefined)
  assert.equal(unidentified.name, "기존 이름")
  assert.equal(lookup.mock.callCount(), 0)
})

test("프로필 세션 갱신은 비어 있는 DB 이름을 반영한다", async () => {
  mockDatabaseMethod(prisma.user, "findUnique", async () => ({ name: null }))
  const cleared = await authOptions.callbacks!.jwt!({
    token: { id: user.id, name: "이전 이름" }, user: undefined as never, account: null, trigger: "update",
  })
  assert.equal(cleared.name, undefined)
})

test("세션 이름 조회 DB 장애는 로그인 식별자와 기존 이름을 보존하고 과거 토큰을 정리한다", async () => {
  mockDatabaseMethod(prisma.user, "findUnique", async () => { throw new Error("이름 조회 실패") })
  const warning = mock.method(console, "warn", () => {})
  const token = await authOptions.callbacks!.jwt!({
    token: { id: user.id, email: user.email, name: "이전 이름", accessToken: "old-access", refreshToken: "old-refresh" },
    user: undefined as never, account: null, trigger: "update",
    session: { id: "other-user", name: "주입한 이름" },
  })
  assert.equal(token.id, user.id)
  assert.equal(token.email, user.email)
  assert.equal(token.name, "이전 이름")
  assert.equal("accessToken" in token, false)
  assert.equal("refreshToken" in token, false)
  assert.equal(warning.mock.callCount(), 1)
})

test("이름 저장은 세션 표시 이름 조회 장애와 독립적으로 성공한다", async () => {
  const access = await generateAccessToken({ userId: user.id, email: user.email })
  mockDatabaseMethod(prisma.user, "update", async () => ({ ...user, name: "저장한 이름", image: null }))
  mockDatabaseMethod(prisma.user, "findUnique", async () => { throw new Error("세션 이름 조회 실패") })
  mock.method(console, "warn", () => {})

  const response = await updateProfile(request({ name: "저장한 이름" }, "accessToken=" + access))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.name, "저장한 이름")
  const token = await authOptions.callbacks!.jwt!({
    token: { id: user.id, name: "이전 이름" }, user: undefined as never, account: null, trigger: "update",
  })
  assert.equal(token.name, "이전 이름")
})
interface StoredRefreshToken {
  token: string
  userId: string
  expiresAt: Date
}

interface RefreshDeleteArgs {
  where: { token?: { in: string[] }; userId?: string; expiresAt?: { gt: Date } }
}

function mockRefreshStorage(initial: StoredRefreshToken[] = []) {
  const rows = new Map(initial.map((row) => [row.token, row]))
  const created: StoredRefreshToken[] = []
  const deleted: RefreshDeleteArgs["where"][] = []
  const deleteMany = async ({ where }: RefreshDeleteArgs) => {
    deleted.push(where)
    let count = 0
    for (const [key, row] of rows) {
      if (where.token && !where.token.in.includes(key)) continue
      if (where.userId !== undefined && where.userId !== row.userId) continue
      if (where.expiresAt && row.expiresAt <= where.expiresAt.gt) continue
      rows.delete(key)
      count++
    }
    return { count }
  }
  const tx = { refreshToken: {
    deleteMany,
    create: async ({ data }: { data: StoredRefreshToken }) => {
      assert.ok(data.token.length <= 191, "RefreshToken.token 컬럼 길이를 초과했습니다.")
      created.push(data)
      rows.set(data.token, data)
      return data
    },
  } }
  mock.method(prisma, "$transaction", (async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
    callback(tx as unknown as Prisma.TransactionClient)) as typeof prisma.$transaction)
  mockDatabaseMethod(prisma.refreshToken, "deleteMany", async (...args) => deleteMany(args[0] as RefreshDeleteArgs))
  return { rows, created, deleted }
}

test("갱신 토큰 DB 해시는 SHA-256의 64자 소문자 hex 값이다", () => {
  assert.equal(hashRefreshToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
})

test("긴 이메일로 회원가입해도 DB에는 64자 해시를 저장하고 쿠키에는 원문 JWT를 발급한다", async () => {
  const longEmail = `${"a".repeat(63)}@${"b".repeat(63)}.${"c".repeat(59)}.com`
  assert.equal(longEmail.length, 191)
  const registered = { id: user.id, email: longEmail, name: "길이 검증 사용자" }
  mockDatabaseMethod(prisma.user, "findUnique", async () => null)
  mockDatabaseMethod(prisma.user, "create", async () => registered)
  const storage = mockRefreshStorage()

  const cookies = mockCookies()
  const response = await register(request({ email: longEmail, password: "test-password", name: registered.name }))
  assert.equal(response.status, 201)
  const raw = cookies.values.get("refreshToken")!
  assert.ok(raw.length > 191)
  assert.equal(storage.created.length, 1)
  assert.deepEqual(storage.deleted[0], { userId: registered.id })
  assert.equal(storage.created[0].token.length, 64)
  assert.match(storage.created[0].token, /^[a-f0-9]{64}$/)
  assert.equal(storage.created[0].token, hashRefreshToken(raw))
  assert.notEqual(storage.created[0].token, raw)
  assert.equal((await verifyRefreshToken(raw))?.email, longEmail)
  assert.equal((await verifyAccessToken(cookies.values.get("accessToken")!))?.email, longEmail)
  assert.equal("tokens" in await response.json(), false)
})

for (const format of ["hash", "raw", "both"] as const) {
  test(`${format} 형식의 유효한 갱신 토큰은 한 번만 교체하며 재사용 실패가 새 쿠키를 지우지 않는다`, async () => {
    const raw = await generateRefreshToken({ userId: user.id, email: user.email })
    const hashed = hashRefreshToken(raw)
    const keys = format === "both" ? [hashed, raw] : [format === "hash" ? hashed : raw]
    const storage = mockRefreshStorage(keys.map((token) => ({ token, userId: user.id, expiresAt: new Date(Date.now() + 60_000) })))
    mockDatabaseMethod(prisma.user, "findUnique", async () => user)
    const cookies = mockCookies()
    const response = await refresh(request({}, `refreshToken=${raw}`))
    assert.equal(response.status, 200)
    assert.equal(storage.created.length, 1)
    assert.equal(storage.rows.size, 1)
    assert.equal(storage.created[0].token.length, 64)
    const rotatedCookie = cookies.values.get("refreshToken")!
    assert.notEqual(rotatedCookie, raw)
    assert.equal(storage.created[0].token, hashRefreshToken(rotatedCookie))
    for (const key of keys) assert.equal(storage.rows.has(key), false)
    assert.deepEqual(storage.deleted[0].token!.in, [hashed, raw])
    assert.equal(storage.deleted[0].userId, user.id)
    assert.ok(storage.deleted[0].expiresAt?.gt instanceof Date)
    assert.equal((await refresh(request({}, `refreshToken=${raw}`))).status, 401)
    assert.equal(storage.created.length, 1)
    assert.equal(storage.rows.size, 1)
    assert.equal(cookies.values.get("refreshToken"), rotatedCookie)
    assert.deepEqual(cookies.deleted, [])
    assert.deepEqual(cookies.written, ["accessToken", "refreshToken"])
  })
}

for (const invalid of ["expired", "other-user"] as const) {
  test(`DB 토큰이 ${invalid}인 경우 JWT가 유효해도 갱신하거나 쿠키를 발급하지 않는다`, async () => {
    const raw = await generateRefreshToken({ userId: user.id, email: user.email })
    const storage = mockRefreshStorage([{
      token: hashRefreshToken(raw),
      userId: invalid === "other-user" ? "another-user" : user.id,
      expiresAt: new Date(Date.now() + (invalid === "expired" ? -60_000 : 60_000)),
    }])
    mockDatabaseMethod(prisma.user, "findUnique", async () => user)
    const cookies = mockCookies()
    assert.equal((await refresh(request({}, `refreshToken=${raw}`))).status, 401)
    assert.equal(storage.created.length, 0)
    assert.equal(storage.rows.size, 1)
    assert.deepEqual(cookies.written, [])
  })
}

for (const format of ["hash", "raw"] as const) {
  test(`액세스 토큰이 없어도 로그아웃은 ${format} 형식의 해당 갱신 토큰만 회수한다`, async () => {
    const raw = await generateRefreshToken({ userId: user.id, email: user.email })
    const hashed = hashRefreshToken(raw)
    const key = format === "hash" ? hashed : raw
    const unrelated = { token: "unrelated-token", userId: "another-user", expiresAt: new Date(Date.now() + 60_000) }
    const storage = mockRefreshStorage([
      { token: key, userId: user.id, expiresAt: new Date(Date.now() + 60_000) }, unrelated,
    ])
    const cookies = mockCookies()
    assert.equal((await logout(request({}, `refreshToken=${raw}`))).status, 200)
    assert.equal(storage.rows.has(key), false)
    assert.equal(storage.rows.has(unrelated.token), true)
    assert.deepEqual(storage.deleted[0], { token: { in: [hashed, raw] } })
    assert.deepEqual(cookies.deleted, ["accessToken", "refreshToken"])
  })
}
