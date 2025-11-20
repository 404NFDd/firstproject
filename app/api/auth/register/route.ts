import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { generateAccessToken, generateRefreshToken, setTokenCookie } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    // 입력 검증
    if (!email || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호는 필수입니다." }, { status: 400 })
    }

    // 기존 사용자 확인
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json({ error: "이미 존재하는 이메일입니다." }, { status: 409 })
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10)

    // 사용자 생성
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || email.split("@")[0],
      },
    })

    // 토큰 생성
    const accessToken = await generateAccessToken({
      userId: user.id,
      email: user.email,
    })

    const refreshToken = await generateRefreshToken({
      userId: user.id,
      email: user.email,
    })

    // Refresh Token을 DB에 저장
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: refreshTokenExpires,
      },
    })

    // 토큰을 쿠키에 저장
    await setTokenCookie("accessToken", accessToken, 15 * 60)
    await setTokenCookie("refreshToken", refreshToken, 7 * 24 * 60 * 60)

    return NextResponse.json(
      {
        message: "회원가입이 완료되었습니다.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Register error:", error)
    return NextResponse.json({ error: "회원가입 중 오류가 발생했습니다." }, { status: 500 })
  }
}
