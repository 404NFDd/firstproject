import { type NextRequest, NextResponse } from "next/server"
import { sendDailyBriefing } from "@/lib/daily-briefing"

function getRequestCronSecret(request: NextRequest): { value: string | null; source: string } {
  const headerSecret = request.headers.get("x-cron-secret")
  if (headerSecret) {
    return { value: headerSecret, source: "x-cron-secret" }
  }

  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    return { value: authorization.slice("Bearer ".length).trim(), source: "authorization-bearer" }
  }

  return { value: null, source: "missing" }
}

/**
 * 일일 브리핑 메일을 전송합니다 (Cron Job용)
 */
export async function POST(request: NextRequest) {
  // Cron Secret 인증 (선택사항)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const { value, source } = getRequestCronSecret(request)
    if (!value || value !== cronSecret) {
      const reason = !value ? "missing-secret-header" : `secret-mismatch-via-${source}`
      console.warn(`[daily-briefing] Unauthorized request: ${reason}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const result = await sendDailyBriefing()

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "일일 브리핑 전송에 실패했습니다." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      sent: result.sent || 0,
      failed: result.failed || 0,
      total: result.total || 0,
      message: `${result.sent || 0}명에게 일일 브리핑이 전송되었습니다.`,
    })
  } catch (error) {
    console.error("[v0] Error sending daily briefing:", error)
    return NextResponse.json({ error: "일일 브리핑 전송 중 오류가 발생했습니다." }, { status: 500 })
  }
}

/**
 * GET 요청도 지원 (테스트용)
 */
export async function GET(request: NextRequest) {
  return POST(request)
}

