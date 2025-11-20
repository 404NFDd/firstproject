import { type NextRequest, NextResponse } from "next/server"
import { verifyAccessToken } from "@/lib/auth"
import { sendNewsEmail } from "@/lib/email-service"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const { newsIds, title } = await request.json()

    if (!newsIds || !Array.isArray(newsIds) || newsIds.length === 0) {
      return NextResponse.json({ error: "뉴스 ID 배열이 필요합니다." }, { status: 400 })
    }

    // 사용자 정보 조회
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    })

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    // 뉴스 정보 조회
    const news = await prisma.news.findMany({
      where: {
        id: {
          in: newsIds,
        },
      },
    })

    if (news.length === 0) {
      return NextResponse.json({ error: "선택된 뉴스를 찾을 수 없습니다." }, { status: 404 })
    }

    // 이메일 발송
    const result = await sendNewsEmail(user.email, news, title || `NewsHub - ${news.length}개 기사`)

    if (!result.success) {
      return NextResponse.json({ error: "이메일 발송에 실패했습니다." }, { status: 500 })
    }

    return NextResponse.json({
      message: "이메일이 성공적으로 발송되었습니다.",
      messageId: result.messageId,
    })
  } catch (error) {
    console.error("[v0] Error sending news email:", error)
    return NextResponse.json({ error: "이메일 발송 중 오류가 발생했습니다." }, { status: 500 })
  }
}
