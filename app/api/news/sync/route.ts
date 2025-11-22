import { NextResponse, type NextRequest } from "next/server"
import { ingestLatestNews, SUPPORTED_NEWS_CATEGORIES } from "@/lib/news-service"

function authorize(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return true
  }

  const headerValue = request.headers.get("x-cron-secret")
  return headerValue === cronSecret
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const payload = await request.json().catch(() => ({}))
    const categories = Array.isArray(payload?.categories)
      ? payload.categories.filter((category: string) => SUPPORTED_NEWS_CATEGORIES.includes(category as any))
      : undefined

    const result = await ingestLatestNews({
      categories,
      limitPerCategory: payload?.limitPerCategory,
      includeRss: payload?.includeRss,
      rssLimit: payload?.rssLimit,
    })

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    console.error("Error syncing news:", error)
    return NextResponse.json({ error: "뉴스 동기화 실패" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}

