import { type NextRequest, NextResponse } from "next/server"
import { sendDailyBriefing } from "@/lib/daily-briefing"
import { isAuthorizedCron } from "@/lib/cron-auth"

/**
 * 일일 브리핑 메일을 전송합니다 (Cron Job용)
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
  }

  try {
    const result = await sendDailyBriefing()

    if (!result.success) {
      return NextResponse.json(
        { ...result, error: result.error || "일일 브리핑 전송에 실패했습니다." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      sent: result.sent || 0,
      failed: result.failed || 0,
      total: result.total || 0,
      skipped: result.skipped || 0,
      uncertain: result.uncertain || 0,
      message: `${result.sent || 0}명에게 일일 브리핑이 전송되었습니다.`,
    })
  } catch (error) {
    console.error("[v0] Error sending daily briefing:", error)
    return NextResponse.json({ error: "일일 브리핑 전송 중 오류가 발생했습니다." }, { status: 500 })
  }
}

/**
 * 스케줄러의 GET 호출도 동일하게 인증한다.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}

