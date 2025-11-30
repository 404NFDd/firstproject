import { type NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * 메일 구독 상태를 토글합니다
 */
export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const { subscribe } = await request.json()

    // 구독 상태 업데이트 (1: 구독, 0: 구독 해제)
    const emailSubscription = subscribe === true ? 1 : 0

    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { emailSubscription },
      select: {
        id: true,
        email: true,
        emailSubscription: true,
      },
    })

    return NextResponse.json({
      success: true,
      emailSubscription: user.emailSubscription,
      message: emailSubscription === 1 ? "메일 구독이 활성화되었습니다." : "메일 구독이 해제되었습니다.",
    })
  } catch (error) {
    console.error("[v0] Error toggling email subscription:", error)
    return NextResponse.json({ error: "구독 설정 변경에 실패했습니다." }, { status: 500 })
  }
}

/**
 * 현재 메일 구독 상태를 조회합니다
 */
export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        emailSubscription: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    return NextResponse.json({
      emailSubscription: user.emailSubscription === 1,
    })
  } catch (error) {
    console.error("[v0] Error getting email subscription:", error)
    return NextResponse.json({ error: "구독 상태 조회에 실패했습니다." }, { status: 500 })
  }
}

