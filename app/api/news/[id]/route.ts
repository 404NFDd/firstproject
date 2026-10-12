import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import { getRequestUser } from "@/lib/request-auth"
import { getArticleTranslation, getListTranslations } from "@/lib/news-translation"
import { isCurationArticle } from "@/lib/news-curation"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const payload = await getRequestUser(request)

    const news = await prisma.news.findUnique({
      where: { id },
    })

    if (!news || EXCLUDED_COMMUNITY_SOURCES.includes(news.source)) {
      return NextResponse.json({ error: "뉴스를 찾을 수 없습니다." }, { status: 404 })
    }
    if (isCurationArticle(news) && !(await getListTranslations([news])).has(news.id)) {
      return NextResponse.json({ error: "뉴스를 찾을 수 없습니다." }, { status: 404 })
    }

    // 읽음 이력 기록 (인증된 사용자만)
    if (payload) {
      try {
        await prisma.newsReadHistory.upsert({
          where: {
            userId_newsId: {
              userId: payload.userId,
              newsId: id,
            },
          },
          update: {
            readCount: { increment: 1 },
            updatedAt: new Date(),
          },
          create: {
            userId: payload.userId,
            newsId: id,
            readCount: 1,
          },
        })
      } catch (error) {
        console.error("Error recording read history:", error)
      }
    }

    return NextResponse.json({ ...news, translation: await getArticleTranslation(news) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error fetching news detail:", error)
    return NextResponse.json({ error: "뉴스 상세 정보를 불러올 수 없습니다." }, { status: 500 })
  }
}
