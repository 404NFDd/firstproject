import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyRefreshToken, issueSessionTokens, clearSessionCookies } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("refreshToken")?.value
    if (!refreshToken) {
      return NextResponse.json({ error: "갱신 토큰을 찾을 수 없습니다." }, { status: 401 })
    }

    const payload = await verifyRefreshToken(refreshToken)
    if (!payload) {
      await clearSessionCookies()
      return NextResponse.json({ error: "유효하지 않은 갱신 토큰입니다." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true },
    })
    if (!user) {
      await clearSessionCookies()
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    const tokens = await issueSessionTokens(user, refreshToken)
    if (!tokens) {
      // 동시에 성공한 갱신 요청의 새 쿠키를 지우지 않도록 유지합니다.
      return NextResponse.json({ error: "갱신 토큰이 만료되었거나 재사용되었습니다." }, { status: 401 })
    }

    return NextResponse.json({ message: "토큰이 갱신되었습니다." })
  } catch (error) {
    console.error("Refresh token error:", error)
    return NextResponse.json({ error: "토큰 갱신 중 오류가 발생했습니다." }, { status: 500 })
  }
}
