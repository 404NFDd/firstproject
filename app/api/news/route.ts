import { type NextRequest, NextResponse } from "next/server"
import { getNews } from "@/lib/news-service"

export async function GET(request: NextRequest) {
  try {
    // Input: query string(page/limit/q/category/sort/minPriority)
    // Output: 뉴스 목록 + pagination JSON
    // Note: 파라미터 미입력 시 page=1, limit=12, sort=latest 기본값을 사용
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
    if (error instanceof Error && error.name === "PrismaClientInitializationError") {
      return NextResponse.json(
        { error: "DB 서버에 연결할 수 없습니다. 데이터베이스 상태를 확인해주세요." },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: "뉴스를 불러올 수 없습니다." }, { status: 500 })
  }
}
