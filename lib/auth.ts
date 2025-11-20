import { jwtVerify, SignJWT } from "jose"
import { cookies } from "next/headers"

const access_secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET || "access-secret")
const refresh_secret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || "refresh-secret")

export interface TokenPayload {
  userId: string
  email: string
  iat?: number
  exp?: number
}

// Access Token 생성
export async function generateAccessToken(payload: TokenPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${process.env.JWT_ACCESS_EXPIRES_IN || 900}s`)
    .sign(access_secret)
}

// Refresh Token 생성
export async function generateRefreshToken(payload: TokenPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${process.env.JWT_REFRESH_EXPIRES_IN || 604800}s`)
    .sign(refresh_secret)
}

// Access Token 검증
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, access_secret)
    return verified.payload as TokenPayload
  } catch (err) {
    return null
  }
}

// Refresh Token 검증
export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, refresh_secret)
    return verified.payload as TokenPayload
  } catch (err) {
    return null
  }
}

// 토큰을 쿠키에 저장
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
export async function clearTokenCookie(name: string) {
  const cookieStore = await cookies()
  cookieStore.delete(name)
}

// 액세스 토큰 가져오기
export async function getAccessToken() {
  const cookieStore = await cookies()
  return cookieStore.get("accessToken")?.value
}

// Refresh 토큰 가져오기
export async function getRefreshToken() {
  const cookieStore = await cookies()
  return cookieStore.get("refreshToken")?.value
}
