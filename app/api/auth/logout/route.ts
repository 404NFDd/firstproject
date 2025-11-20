import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clearTokenCookie, verifyAccessToken } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value

    const payload = await verifyAccessToken(accessToken || "")

    if (payload) {
      // DB에서 모든 Refresh Token 제거
      await prisma.refreshToken.deleteMany({
        where: { userId: payload.userId },
      })
    }

    // 쿠키 제거
    await clearTokenCookie("accessToken")
    await clearTokenCookie("refreshToken")

    return NextResponse.json({ message: "로그아웃이 완료되었습니다." }, { status: 200 })
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "로그아웃 중 오류가 발생했습니다." }, { status: 500 })
  }
}
