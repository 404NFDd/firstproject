import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyRefreshToken, generateAccessToken, setTokenCookie } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("refreshToken")?.value

    if (!refreshToken) {
      return NextResponse.json({ error: "Refresh token을 찾을 수 없습니다." }, { status: 401 })
    }

    const payload = await verifyRefreshToken(refreshToken)

    if (!payload) {
      return NextResponse.json({ error: "유효하지 않은 Refresh token입니다." }, { status: 401 })
    }

    // DB에서 Refresh Token 확인
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    })

    if (!storedToken || new Date() > storedToken.expiresAt) {
      return NextResponse.json({ error: "Refresh token이 만료되었습니다." }, { status: 401 })
    }

    // 새로운 Access Token 생성
    const newAccessToken = await generateAccessToken({
      userId: payload.userId,
      email: payload.email,
    })

    await setTokenCookie("accessToken", newAccessToken, 15 * 60)

    return NextResponse.json({ message: "토큰이 갱신되었습니다." }, { status: 200 })
  } catch (error) {
    console.error("Refresh token error:", error)
    return NextResponse.json({ error: "토큰 갱신 중 오류가 발생했습니다." }, { status: 500 })
  }
}
