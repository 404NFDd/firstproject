import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { issueSessionTokens } from "@/lib/auth"
import { loginSchema } from "@/lib/auth-validation"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "이메일 또는 관리자 아이디와 비밀번호를 입력하세요." }, { status: 400 })
    }
    const { email, password } = parsed.data
    const user = await prisma.user.findUnique({ where: email.includes("@") ? { email } : { adminUsername: email } })
    if (!user || (!email.includes("@") && !user.isAdmin) || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ error: "아이디 또는 비밀번호가 일치하지 않습니다." }, { status: 401 })
    }

    await issueSessionTokens({ id: user.id, email: user.email })
    return NextResponse.json({
      message: "로그인이 완료되었습니다.",
      user: { id: user.id, email: user.email, name: user.name, image: user.image, isAdmin: user.isAdmin },
    })
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "로그인 중 오류가 발생했습니다." }, { status: 500 })
  }
}
