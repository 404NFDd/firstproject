import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const { newsId } = await request.json()

    const bookmark = await prisma.newsBookmark.create({
      data: {
        userId: payload.userId,
        newsId,
      },
    })

    return NextResponse.json(bookmark, { status: 201 })
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ message: "이미 즐겨찾기된 뉴스입니다." }, { status: 200 })
    }
    return NextResponse.json({ error: "즐겨찾기 저장 중 오류가 발생했습니다." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value
    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const newsId = searchParams.get("newsId")

    if (!newsId) {
      return NextResponse.json({ error: "뉴스 ID가 필요합니다." }, { status: 400 })
    }

    await prisma.newsBookmark.delete({
      where: {
        userId_newsId: {
          userId: payload.userId,
          newsId,
        },
      },
    })

    return NextResponse.json({ message: "즐겨찾기가 제거되었습니다." })
  } catch (error) {
    console.error("Error removing bookmark:", error)
    return NextResponse.json({ error: "즐겨찾기 제거 중 오류가 발생했습니다." }, { status: 500 })
  }
}
