import { type NextRequest, NextResponse } from "next/server"
import { generateRSSFeed } from "@/lib/rss-service"

export async function GET(request: NextRequest) {
  try {
    const protocol = request.headers.get("x-forwarded-proto") || "http"
    const host = request.headers.get("host") || "localhost:3000"
    const baseUrl = `${protocol}://${host}`

    const rssFeed = await generateRSSFeed(baseUrl)

    if (!rssFeed) {
      return NextResponse.json({ error: "RSS 피드 생성 실패" }, { status: 500 })
    }

    return new NextResponse(rssFeed, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Content-Disposition": "inline; filename=newshub-feed.xml",
      },
    })
  } catch (error) {
    console.error("[v0] Error generating RSS feed:", error)
    return NextResponse.json({ error: "RSS 피드를 생성할 수 없습니다." }, { status: 500 })
  }
}
