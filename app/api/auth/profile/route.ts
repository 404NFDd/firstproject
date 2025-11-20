import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth"

export async function PUT(request: NextRequest) {
  try {
    const accessToken = request.cookies.get("accessToken")?.value

    const payload = await verifyAccessToken(accessToken || "")

    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const { name } = await request.json()

    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { name },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    })

    return NextResponse.json({ user }, { status: 200 })
  } catch (error) {
    console.error("Error updating profile:", error)
    return NextResponse.json({ error: "프로필 업데이트 중 오류가 발생했습니다." }, { status: 500 })
  }
}
