import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    const news = await prisma.news.findUnique({
      where: { id },
      include: {
        bookmarks: payload ? { where: { userId: payload.userId } } : false,
      },
    })

    if (!news) {
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

    return NextResponse.json(news)
  } catch (error) {
    console.error("Error fetching news detail:", error)
    return NextResponse.json({ error: "뉴스 상세 정보를 불러올 수 없습니다." }, { status: 500 })
  }
}
