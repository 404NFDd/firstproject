import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "12")

    const skip = (page - 1) * limit

    const [bookmarks, total] = await Promise.all([
      prisma.newsBookmark.findMany({
        where: { userId: payload.userId },
        include: { news: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.newsBookmark.count({ where: { userId: payload.userId } }),
    ])

    return NextResponse.json({
      bookmarks: bookmarks.map((b) => b.news),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Error fetching bookmarks:", error)
    return NextResponse.json({ error: "즐겨찾기를 불러올 수 없습니다." }, { status: 500 })
  }
}
