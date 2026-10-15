import { jwtVerify, SignJWT, type JWTPayload } from "jose"
import { cookies } from "next/headers"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"

function getTokenSecret(name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET") {
  const secret = process.env[name]
  if (!secret) throw new Error(`${name} 환경 변수가 필요합니다.`)
  return new TextEncoder().encode(secret)
}
function getTokenMaxAge(name: "JWT_ACCESS_EXPIRES_IN" | "JWT_REFRESH_EXPIRES_IN", fallback: number) {
  const value = process.env[name]
  if (!value) return fallback
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error(`${name}은 양의 정수(초)여야 합니다.`)
  return seconds
}

const ACCESS_TOKEN_MAX_AGE = getTokenMaxAge("JWT_ACCESS_EXPIRES_IN", 60 * 60)
const REFRESH_TOKEN_MAX_AGE = getTokenMaxAge("JWT_REFRESH_EXPIRES_IN", 7 * 24 * 60 * 60)

export interface TokenPayload extends JWTPayload {
  userId: string
  email: string
  iat?: number
  exp?: number
}

// Access Token 생성
// Input: 사용자 식별 payload
// Output: 서명된 JWT access token 문자열
export async function generateAccessToken(payload: TokenPayload) {
  return await new SignJWT({ ...payload, tokenType: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${ACCESS_TOKEN_MAX_AGE}s`)
    .sign(getTokenSecret("JWT_ACCESS_SECRET"))
}

// Refresh Token 생성
// Input: 사용자 식별 payload
// Output: 서명된 JWT refresh token 문자열
export async function generateRefreshToken(payload: TokenPayload) {
  return await new SignJWT({ ...payload, tokenType: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${REFRESH_TOKEN_MAX_AGE}s`)
    .sign(getTokenSecret("JWT_REFRESH_SECRET"))
}

// Access Token 검증
// Input: JWT access token 문자열
// Output: 검증된 payload 또는 null
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, getTokenSecret("JWT_ACCESS_SECRET"), { algorithms: ["HS256"] })
    if (typeof verified.payload.userId !== "string" || !verified.payload.userId || typeof verified.payload.email !== "string" || !verified.payload.email || typeof verified.payload.exp !== "number" || verified.payload.tokenType !== "access") return null
    return verified.payload as TokenPayload
  } catch {
    return null
  }
}

// Refresh Token 검증
// Input: JWT refresh token 문자열
// Output: 검증된 payload 또는 null
export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, getTokenSecret("JWT_REFRESH_SECRET"), { algorithms: ["HS256"] })
    if (typeof verified.payload.userId !== "string" || !verified.payload.userId || typeof verified.payload.email !== "string" || !verified.payload.email || typeof verified.payload.exp !== "number" || verified.payload.tokenType !== "refresh") return null
    return verified.payload as TokenPayload
  } catch {
    return null
  }
}

// 토큰을 쿠키에 저장
// Input: 쿠키 이름, 토큰 값, maxAge(초)
// Output: httpOnly 쿠키 설정(반환값 없음)
export async function setTokenCookie(name: string, value: string, maxAge: number) {
  const cookieStore = await cookies()
  cookieStore.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  })
}

// 토큰 쿠키 제거
// Input: 쿠키 이름
// Output: 해당 쿠키 삭제
export async function clearTokenCookie(name: string) {
  const cookieStore = await cookies()
  cookieStore.delete(name)
}

// 세션 쿠키(access/refresh) 일괄 정리
// Input: 없음
// Output: accessToken/refreshToken 쿠키 삭제
export async function clearSessionCookies() {
  await clearTokenCookie("accessToken")
  await clearTokenCookie("refreshToken")
}

// 액세스 토큰 가져오기
// Input: 없음
// Output: accessToken 쿠키 값 또는 undefined
export async function getAccessToken() {
  const cookieStore = await cookies()
  return cookieStore.get("accessToken")?.value
}

// Refresh 토큰 가져오기
// Input: 없음
// Output: refreshToken 쿠키 값 또는 undefined
export async function getRefreshToken() {
  const cookieStore = await cookies()
  return cookieStore.get("refreshToken")?.value
}

// 쿠키의 원문 JWT는 유지하고 DB에는 고정 길이 해시만 저장합니다.
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

// 사용자 refresh token DB 레코드 제거
// Input: userId
// Output: 해당 유저의 refresh token 일괄 삭제
export async function revokeUserRefreshTokens(userId: string) {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  })
}

// 로그인 세션 토큰 발급/저장
// Input: 사용자 id/email
// Output: access/refresh token과 refresh 만료시각
interface SessionTokens {
  accessToken: string
  refreshToken: string
  refreshTokenExpires: Date
}

export function issueSessionTokens(user: { id: string; email: string }): Promise<SessionTokens>
export function issueSessionTokens(user: { id: string; email: string }, previousRefreshToken: string): Promise<SessionTokens | null>
export async function issueSessionTokens(user: { id: string; email: string }, previousRefreshToken?: string): Promise<SessionTokens | null> {
  const payload = { userId: user.id, email: user.email }
  const [accessToken, refreshToken] = await Promise.all([generateAccessToken(payload), generateRefreshToken(payload)])
  const refreshTokenExpires = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE * 1000)

  const stored = await prisma.$transaction(async (tx) => {
    if (previousRefreshToken !== undefined) {
      const consumed = await tx.refreshToken.deleteMany({
        where: { token: { in: [hashRefreshToken(previousRefreshToken), previousRefreshToken] }, userId: user.id, expiresAt: { gt: new Date() } },
      })
      if (consumed.count === 0) return false
    } else {
      await tx.refreshToken.deleteMany({ where: { userId: user.id } })
    }
    await tx.refreshToken.create({
      data: { token: hashRefreshToken(refreshToken), userId: user.id, expiresAt: refreshTokenExpires },
    })
    return true
  })
  if (!stored) return null

  await setTokenCookie("accessToken", accessToken, ACCESS_TOKEN_MAX_AGE)
  await setTokenCookie("refreshToken", refreshToken, REFRESH_TOKEN_MAX_AGE)
  return { accessToken, refreshToken, refreshTokenExpires }
}

export { ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE }
