import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import { getArticleTranslation, getListTranslations } from "@/lib/news-translation"
import { isCurationArticle } from "@/lib/news-curation"

export const maxDuration = 30
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 기존 클라이언트를 위한 상태 조회 경로입니다. 조회가 번역 API를 호출하지 않습니다.
  const origin = request.headers.get("origin")
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "같은 사이트에서 요청해주세요." }, { status: 403 })
  }
  try {
    const { id } = await params
    const article = await prisma.news.findUnique({ where: { id } })
    if (!article || EXCLUDED_COMMUNITY_SOURCES.includes(article.source)) {
      return NextResponse.json({ error: "뉴스를 찾을 수 없습니다." }, { status: 404 })
    }
    const translation = await getArticleTranslation(article)
    if (isCurationArticle(article) && !(await getListTranslations([article])).has(article.id)) {
      return NextResponse.json({ error: "뉴스를 찾을 수 없습니다." }, { status: 404 })
    }
    return NextResponse.json({ translation }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "한국어 번역을 불러오지 못했습니다." }, { status: 503 })
  }
}
