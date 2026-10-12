import type { NextAuthOptions } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { issueSessionTokens, ACCESS_TOKEN_MAX_AGE } from "@/lib/auth"
import { loginSchema } from "@/lib/auth-validation"

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: ACCESS_TOKEN_MAX_AGE,
  },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: parsed.data.email.includes("@") ? { email: parsed.data.email } : { adminUsername: parsed.data.email },
        })
        if (!user || (!parsed.data.email.includes("@") && !user.isAdmin) || !(await bcrypt.compare(parsed.data.password, user.password))) return null

        await issueSessionTokens({ id: user.id, email: user.email })
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          isAdmin: user.isAdmin,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
        token.isAdmin = user.isAdmin
      } else if (trigger === "update" && typeof token.id === "string" && token.id) {
        // 브라우저가 보낸 이름 대신 로그인한 사용자의 DB 값을 사용합니다.
        try {
          const savedUser = await prisma.user.findUnique({
            where: { id: token.id },
            select: { name: true },
          })
          if (savedUser) token.name = savedUser.name ?? undefined
        } catch {
          // 표시 이름 조회 장애로 정상 로그인 세션을 삭제하지 않습니다.
          console.warn("프로필 세션의 표시 이름을 갱신하지 못했습니다.")
        }
      }
      // 기존 로그인 쿠키의 중복 토큰도 다음 세션 조회에서 정리합니다.
      delete token.accessToken
      delete token.refreshToken
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string | undefined
        session.user.email = token.email as string | undefined
        session.user.image = session.user.image ?? undefined
        session.user.isAdmin = token.isAdmin === true
      }
      return session
    },
  },
}
