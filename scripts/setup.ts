/**
 * 뉴스 대시보드 초기 설정 스크립트
 * 이 스크립트를 실행하려면: npx tsx scripts/setup.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🚀 뉴스 대시보드 초기 설정 시작...")

  // Prisma 마이그레이션 확인
  console.log("✅ 데이터베이스 연결 확인...")

  try {
    // 사용자 테이블 확인
    const userCount = await prisma.user.count()
    console.log(`✅ 사용자 테이블: ${userCount}명의 사용자`)

    // 뉴스 테이블 확인
    const newsCount = await prisma.news.count()
    console.log(`✅ 뉴스 테이블: ${newsCount}개의 뉴스`)

    console.log("\n✨ 초기 설정 완료!")
    console.log("\n📝 다음 단계:")
    console.log("1. .env 파일을 생성하고 환경 변수를 설정하세요")
    console.log("2. 네이버 뉴스는 별도 API 키 없이 수집합니다")
    console.log("3. 'npm run dev'로 개발 서버를 시작하세요")
    console.log("4. http://localhost:3000/auth/register에서 계정을 만드세요")
  } catch (error) {
    console.error("❌ 오류 발생:", error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
