import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { cookies } from "next/headers"
import { clearSessionCookies, verifyAccessToken, revokeUserRefreshTokens, hashRefreshToken } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value

    const payload = await verifyAccessToken(accessToken || "")

    if (payload) {
      await revokeUserRefreshTokens(payload.userId)
    } else {
      // 토큰을 복호화할 수 없으면 쿠키 기반으로 사용자 탐색
      const refreshToken = request.cookies.get("refreshToken")?.value
      if (refreshToken) {
        await prisma.refreshToken.deleteMany({ where: { token: { in: [hashRefreshToken(refreshToken), refreshToken] } } })
      }
    }

    return NextResponse.json({ message: "로그아웃이 완료되었습니다." }, { status: 200 })
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "로그아웃 중 오류가 발생했습니다." }, { status: 500 })
  } finally {
    await clearSessionCookies()
    const cookieStore = await cookies()
    for (const cookie of cookieStore.getAll()) {
      if (/^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name)) cookieStore.delete(cookie.name)
    }
  }
}
