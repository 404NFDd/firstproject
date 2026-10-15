import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getRequestUser } from "@/lib/request-auth"
import { sendNewsEmail } from "@/lib/email-service"
import { EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import { prisma } from "@/lib/prisma"
import { PUBLISHED_SUMMARY_FILTER, getListSummaries } from "@/lib/news-summary-service"
import { isCurationArticle } from "@/lib/news-curation"

const emailRequestSchema = z.object({
  newsIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50)
    .transform((ids) => [...new Set(ids)]),
  title: z.string().trim().max(200).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const payload = await getRequestUser(request)

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "JSON 형식이 올바르지 않습니다." }, { status: 400 })
    }
    const parsed = emailRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "뉴스 ID는 1~50개 문자열 배열, 제목은 200자 이하 문자열이어야 합니다." }, { status: 400 })
    }
    const { newsIds, title } = parsed.data

    // 사용자 정보 조회
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true },
    })

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    // 뉴스 정보 조회
    const news = await prisma.news.findMany({
      where: {
        source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] },
        ...PUBLISHED_SUMMARY_FILTER,
        id: {
          in: newsIds,
        },
      },
    })

    if (news.length === 0) {
      return NextResponse.json({ error: "선택된 뉴스를 찾을 수 없습니다." }, { status: 404 })
    }

    // 이메일 발송
    const summaries = await getListSummaries(news.filter(isCurationArticle))
    const emailNews = news.map((article) => {
      const summary = summaries.get(article.id)
      return summary?.isSummary ? { ...article, title: summary.title, description: summary.preview, content: null, isAiSummary: true }
        : { ...article, description: null, content: null }
    })
    const result = await sendNewsEmail(user.email, emailNews, title || `NewsHub - ${news.length}개 기사`)

    if (!result.success) {
      return NextResponse.json({ error: "이메일 발송에 실패했습니다." }, { status: 500 })
    }

    return NextResponse.json({
      message: "이메일이 성공적으로 발송되었습니다.",
      messageId: result.messageId,
    })
  } catch (error) {
    console.error("기사 이메일 발송 실패:", error)
    return NextResponse.json({ error: "이메일 발송 중 오류가 발생했습니다." }, { status: 500 })
  }
}
