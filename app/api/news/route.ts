import { type NextRequest, NextResponse } from "next/server"
import { getNews } from "@/lib/news-service"
import { newsQuerySchema } from "@/lib/news-validation"

export async function GET(request: NextRequest) {
  try {
    // Input: query string(page/limit/q/category/sort/minPriority)
    // Output: 뉴스 목록 + pagination JSON
    // Note: 파라미터 미입력 시 page=1, limit=12, sort=latest 기본값을 사용
    const searchParams = request.nextUrl.searchParams
    const query = newsQuerySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      search: searchParams.get("q") ?? searchParams.get("search") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      minPriority: searchParams.get("minPriority") ?? undefined,
    })
    if (!query.success) {
      return NextResponse.json({ error: "뉴스 조회 조건이 올바르지 않습니다." }, { status: 400 })
    }

    const data = await getNews(query.data)

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
