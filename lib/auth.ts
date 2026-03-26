import { jwtVerify, SignJWT } from "jose"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

const access_secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET || "access-secret")
const refresh_secret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || "refresh-secret")
const ACCESS_TOKEN_MAX_AGE = Number(process.env.JWT_ACCESS_EXPIRES_IN) || 15 * 60
const REFRESH_TOKEN_MAX_AGE = Number(process.env.JWT_REFRESH_EXPIRES_IN) || 7 * 24 * 60 * 60

export interface TokenPayload {
  userId: string
  email: string
  iat?: number
  exp?: number
}

// Access Token 생성
// Input: 사용자 식별 payload
// Output: 서명된 JWT access token 문자열
export async function generateAccessToken(payload: TokenPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${process.env.JWT_ACCESS_EXPIRES_IN || 900}s`)
    .sign(access_secret)
}

// Refresh Token 생성
// Input: 사용자 식별 payload
// Output: 서명된 JWT refresh token 문자열
export async function generateRefreshToken(payload: TokenPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${process.env.JWT_REFRESH_EXPIRES_IN || 604800}s`)
    .sign(refresh_secret)
}

// Access Token 검증
// Input: JWT access token 문자열
// Output: 검증된 payload 또는 null
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, access_secret)
    return verified.payload as TokenPayload
  } catch (err) {
    return null
  }
}

// Refresh Token 검증
// Input: JWT refresh token 문자열
// Output: 검증된 payload 또는 null
export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, refresh_secret)
    return verified.payload as TokenPayload
  } catch (err) {
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
export async function issueSessionTokens(user: { id: string; email: string }) {
  const payload = {
    userId: user.id,
    email: user.email,
  }

  const [accessToken, refreshToken] = await Promise.all([generateAccessToken(payload), generateRefreshToken(payload)])
  const refreshTokenExpires = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE * 1000)

  await revokeUserRefreshTokens(user.id)
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: refreshTokenExpires,
    },
  })

  await setTokenCookie("accessToken", accessToken, ACCESS_TOKEN_MAX_AGE)
  await setTokenCookie("refreshToken", refreshToken, REFRESH_TOKEN_MAX_AGE)

  return {
    accessToken,
    refreshToken,
    refreshTokenExpires,
  }
}

export { ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE }
