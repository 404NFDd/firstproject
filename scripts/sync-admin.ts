import { loadEnvConfig } from "@next/env"

async function main() {
  loadEnvConfig(process.cwd())
  const { syncAdminAccount } = await import("../lib/admin")
  const { prisma } = await import("../lib/prisma")
  try {
    const result = await syncAdminAccount()
    console.log(result.created ? "관리자 계정을 생성했습니다." : "관리자 계정을 동기화했습니다.")
    console.log("아이디와 비밀번호는 프로젝트 .env에서 확인하세요. /auth/login에서 로그인 후 /admin으로 이동합니다.")
  } finally {
    await prisma.$disconnect()
  }
}
main().catch(() => {
  console.error("관리자 계정 동기화에 실패했습니다. ADMIN_ID·ADMIN_PASSWORD·ADMIN_EMAIL, DB 연결과 마이그레이션 상태를 확인하세요.")
  process.exitCode = 1
})
