import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyRefreshToken, issueSessionTokens, clearSessionCookies } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("refreshToken")?.value

    if (!refreshToken) {
      return NextResponse.json({ error: "Refresh token을 찾을 수 없습니다." }, { status: 401 })
    }

    const payload = await verifyRefreshToken(refreshToken)

    if (!payload) {
      await clearSessionCookies()
      return NextResponse.json({ error: "유효하지 않은 Refresh token입니다." }, { status: 401 })
    }

    // DB에서 Refresh Token 확인
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    })

    if (!storedToken || storedToken.userId !== payload.userId) {
      await clearSessionCookies()
      return NextResponse.json({ error: "Refresh token이 만료되었거나 재사용되었습니다." }, { status: 401 })
    }

    if (new Date() > storedToken.expiresAt) {
      await clearSessionCookies()
      await prisma.refreshToken.delete({ where: { token: storedToken.token } })
      return NextResponse.json({ error: "Refresh token이 만료되었습니다." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true },
    })

    if (!user) {
      await clearSessionCookies()
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    const tokens = await issueSessionTokens(user)

    return NextResponse.json(
      {
        message: "토큰이 갱신되었습니다.",
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("Refresh token error:", error)
    return NextResponse.json({ error: "토큰 갱신 중 오류가 발생했습니다." }, { status: 500 })
  }
}
