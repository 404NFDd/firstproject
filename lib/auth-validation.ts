import { z } from "zod"

export const loginSchema = z.object({
  email: z.string().trim().max(191).refine((value) => z.string().email().safeParse(value).success || /^[a-zA-Z0-9._-]{3,64}$/.test(value), "이메일 또는 관리자 아이디를 입력하세요."),
  password: z.string().min(1, "비밀번호를 입력하세요.").max(1024),
})

export const registerSchema = loginSchema.extend({
  email: z.string().trim().email("올바른 이메일을 입력하세요.").max(191),
  name: z.string().trim().max(191, "이름은 191자 이내로 입력하세요.").optional(),
})

export const profileSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(191, "이름은 191자 이내로 입력하세요."),
})
