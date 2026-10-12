import { type NextRequest, NextResponse } from "next/server"
import { getRequestUser } from "@/lib/request-auth"
import { sendDailyBriefing } from "@/lib/daily-briefing"
import { prisma } from "@/lib/prisma"

// 구독 상태를 바꾸지 않고 현재 사용자 한 명에게만 전송한다.
export async function POST(request: NextRequest) {
  try {
    const payload = await getRequestUser(request)
    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, email: true } })
    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }
    const result = await sendDailyBriefing(user.id)
    if (!result.success) {
      return NextResponse.json({ error: result.error || "테스트 메일 전송에 실패했습니다." }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      message: result.sent ? `${user.email}로 테스트 메일이 전송되었습니다.` : "지난 24시간 뉴스가 없어 메일 발송을 생략했습니다.",
      sent: result.sent || 0,
      skipped: result.skipped || 0,
    })
  } catch (error) {
    console.error("테스트 브리핑 전송 실패:", error)
    return NextResponse.json({ error: "테스트 메일 전송 중 오류가 발생했습니다." }, { status: 500 })
  }
}