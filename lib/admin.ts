import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getRequestUser } from "@/lib/request-auth"
import type { NextRequest } from "next/server"

export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })
  return user?.isAdmin === true
}

export async function getAdminAccess(request: NextRequest) {
  const user = await getRequestUser(request)
  if (!user) return { allowed: false as const, status: 401 }
  if (!(await isAdminUser(user.userId))) return { allowed: false as const, status: 403 }
  return { allowed: true as const, user }
}

const adminConfigSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/, "관리자 아이디는 영문·숫자·점·밑줄·하이픈 3~64자입니다."),
  password: z.string().min(12, "관리자 비밀번호는 12자 이상이어야 합니다.").refine((value) => Buffer.byteLength(value, "utf8") <= 72, "관리자 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다."),
  email: z.string().email().max(191),
})

export async function syncAdminAccount(env: Record<string, string | undefined> = process.env) {
  const config = adminConfigSchema.parse({ id: env.ADMIN_ID, password: env.ADMIN_PASSWORD, email: env.ADMIN_EMAIL || "admin@newshub.local" })
  return prisma.$transaction(async (tx) => {
    const byId = await tx.user.findUnique({ where: { adminUsername: config.id } })
    const byEmail = await tx.user.findUnique({ where: { email: config.email } })
    if (byEmail && !byEmail.isAdmin) throw new Error("관리자 이메일이 일반 회원과 겹칩니다. ADMIN_EMAIL을 변경하세요.")
    if (byId && byEmail && byId.id !== byEmail.id) throw new Error("관리자 아이디와 이메일이 서로 다른 계정에 연결되어 있습니다.")
    const existing = byId || byEmail
    if (existing && !existing.isAdmin) throw new Error("기존 일반 회원을 관리자 계정으로 변경할 수 없습니다.")
    const passwordChanged = !existing || !(await bcrypt.compare(config.password, existing.password))
    const password = passwordChanged ? await bcrypt.hash(config.password, 12) : existing.password
    const data = { adminUsername: config.id, email: config.email, password, isAdmin: true }
    if (existing) {
      if (passwordChanged) await tx.refreshToken.deleteMany({ where: { userId: existing.id } })
      await tx.user.update({ where: { id: existing.id }, data })
    } else {
      await tx.user.create({ data: { ...data, name: "관리자" } })
    }
    return { created: !existing, passwordChanged }
  })
}
