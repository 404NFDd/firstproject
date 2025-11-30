import { type NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@/lib/auth"
import { sendDailyBriefing } from "@/lib/daily-briefing"

/**
 * 로컬 테스트용: 현재 사용자에게만 일일 브리핑을 전송합니다
 */
export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    // 테스트 모드: 현재 사용자만 임시로 구독 상태로 설정하여 전송
    const { prisma } = await import("@/lib/prisma")
    
    // 사용자 정보 조회
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

    // 임시로 구독 상태로 변경
    const originalSubscription = user.emailSubscription
    await prisma.user.update({
      where: { id: user.id },
      data: { emailSubscription: 1 },
    })

    try {
      // 일일 브리핑 전송
      const result = await sendDailyBriefing()

      // 원래 구독 상태로 복원
      await prisma.user.update({
        where: { id: user.id },
        data: { emailSubscription: originalSubscription },
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "테스트 메일 전송에 실패했습니다." },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: `${user.email}로 테스트 메일이 전송되었습니다.`,
        sent: result.sent || 0,
      })
    } catch (error) {
      // 오류 발생 시에도 원래 상태로 복원
      await prisma.user.update({
        where: { id: user.id },
        data: { emailSubscription: originalSubscription },
      })
      throw error
    }
  } catch (error) {
    console.error("[v0] Error sending test briefing:", error)
    return NextResponse.json({ error: "테스트 메일 전송 중 오류가 발생했습니다." }, { status: 500 })
  }
}

