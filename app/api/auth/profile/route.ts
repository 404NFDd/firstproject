import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRequestUser } from "@/lib/request-auth"
import { profileSchema } from "@/lib/auth-validation"

export async function PUT(request: NextRequest) {
  try {
    const payload = await getRequestUser(request)
    if (!payload) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const parsed = profileSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "이름은 1자 이상 191자 이내로 입력하세요." }, { status: 400 })
    }
    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { name: parsed.data.name },
      select: { id: true, email: true, name: true, image: true },
    })
    return NextResponse.json({ user })
  } catch (error) {
    console.error("Error updating profile:", error)
    return NextResponse.json({ error: "프로필 업데이트 중 오류가 발생했습니다." }, { status: 500 })
  }
}
