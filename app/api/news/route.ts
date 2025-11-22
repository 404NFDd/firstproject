import { type NextRequest, NextResponse } from "next/server"
import { getNews } from "@/lib/news-service"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Number.parseInt(searchParams.get("page") || "1", 10)
    const limit = Number.parseInt(searchParams.get("limit") || "12", 10)
    const query = searchParams.get("q") || undefined
    const category = searchParams.get("category") || undefined
    const sort = (searchParams.get("sort") as "latest" | "priority" | "popular") || "latest"
    const minPriority = searchParams.get("minPriority")

    const data = await getNews({
      page,
      limit,
      category,
      search: query,
      sort,
      minPriority: minPriority ? Number.parseInt(minPriority, 10) : undefined,
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error fetching news:", error)
    return NextResponse.json({ error: "뉴스를 불러올 수 없습니다." }, { status: 500 })
  }
}
