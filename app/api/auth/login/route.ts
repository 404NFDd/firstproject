import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { issueSessionTokens } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호는 필수입니다." }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 401 })
    }

    const passwordMatch = await bcrypt.compare(password, user.password)

    if (!passwordMatch) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 401 })
    }

    const tokens = await issueSessionTokens({ id: user.id, email: user.email })

    return NextResponse.json(
      {
        message: "로그인이 완료되었습니다.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "로그인 중 오류가 발생했습니다." }, { status: 500 })
  }
}
