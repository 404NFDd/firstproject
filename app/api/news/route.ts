import { type NextRequest, NextResponse } from "next/server"
import { mockNews } from "@/data/mock-news"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limit = Number.parseInt(searchParams.get("limit") || "12")
    const query = searchParams.get("q")
    const category = searchParams.get("category")

    let filteredNews = [...mockNews]

    // 카테고리 필터
    if (category && category !== "general") {
      filteredNews = filteredNews.filter((news) => news.category === category)
    }

    // 검색 필터
    if (query) {
      filteredNews = filteredNews.filter(
        (news) =>
          news.title.toLowerCase().includes(query.toLowerCase()) ||
          news.description?.toLowerCase().includes(query.toLowerCase()),
      )
    }

    // 페이지네이션
    const skip = (page - 1) * limit
    const paginatedNews = filteredNews.slice(skip, skip + limit)

    return NextResponse.json({
      news: paginatedNews,
      pagination: {
        total: filteredNews.length,
        page,
        limit,
        pages: Math.ceil(filteredNews.length / limit),
      },
    })
  } catch (error) {
    console.error("[v0] Error fetching news:", error)
    return NextResponse.json({ error: "뉴스를 불러올 수 없습니다." }, { status: 500 })
  }
}
