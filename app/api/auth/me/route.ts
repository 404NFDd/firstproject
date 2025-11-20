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

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 })
    }

    return NextResponse.json({ user }, { status: 200 })
  } catch (error) {
    console.error("Error fetching user:", error)
    return NextResponse.json({ error: "사용자 정보를 불러올 수 없습니다." }, { status: 500 })
  }
}
