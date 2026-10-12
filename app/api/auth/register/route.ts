import { type NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { issueSessionTokens } from "@/lib/auth"
import { registerSchema } from "@/lib/auth-validation"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "이메일, 비밀번호와 이름을 확인하세요." }, { status: 400 })
    }
    const { email, password, name } = parsed.data
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json({ error: "이미 존재하는 이메일입니다." }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name: name || email.split("@")[0] },
    })
    await issueSessionTokens({ id: user.id, email: user.email })

    return NextResponse.json({
      message: "회원가입이 완료되었습니다.",
      user: { id: user.id, email: user.email, name: user.name },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "이미 존재하는 이메일입니다." }, { status: 409 })
    }
    console.error("Register error:", error)
    return NextResponse.json({ error: "회원가입 중 오류가 발생했습니다." }, { status: 500 })
  }
}
