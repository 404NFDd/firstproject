import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clearSessionCookies, verifyAccessToken, revokeUserRefreshTokens } from "@/lib/auth"

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
        await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
      }
    }

    await clearSessionCookies()

    return NextResponse.json({ message: "로그아웃이 완료되었습니다." }, { status: 200 })
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "로그아웃 중 오류가 발생했습니다." }, { status: 500 })
  }
}
