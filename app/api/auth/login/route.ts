import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { generateAccessToken, generateRefreshToken, setTokenCookie } from "@/lib/auth"
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

    // 토큰 생성
    const accessToken = await generateAccessToken({
      userId: user.id,
      email: user.email,
    })

    const refreshToken = await generateRefreshToken({
      userId: user.id,
      email: user.email,
    })

    // 기존 Refresh Token 제거
    await prisma.refreshToken.deleteMany({
      where: { userId: user.id },
    })

    // 새로운 Refresh Token 저장
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
        message: "로그인이 완료되었습니다.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "로그인 중 오류가 발생했습니다." }, { status: 500 })
  }
}
