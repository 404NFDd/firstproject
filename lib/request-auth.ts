import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { verifyAccessToken } from "@/lib/auth"

export async function getRequestUser(request: NextRequest): Promise<{ userId: string; email: string } | null> {
  const accessToken = request.cookies.get("accessToken")?.value
  if (accessToken) {
    const payload = await verifyAccessToken(accessToken)
    if (payload) return { userId: payload.userId, email: payload.email }
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return null

  const token = await getToken({ req: request, secret })
  if (!token || typeof token.id !== "string" || !token.id || typeof token.email !== "string" || !token.email) return null
  if (typeof token.exp !== "number" || token.exp <= Date.now() / 1000) return null

  return { userId: token.id, email: token.email }
}
