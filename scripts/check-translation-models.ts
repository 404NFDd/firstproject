import { checkTranslationModels, getTranslationErrorMessage } from "../lib/news-translation"
import { prisma } from "../lib/prisma"

checkTranslationModels().then((results) => {
  for (const result of results) {
    const label = { success: "번역 성공", quota: "한도 도달", unavailable: "모델 사용 불가", temporary: "일시 오류", failed: "실패", skipped: "호출 대기" }[result.outcome]
    console.log("[모델 확인] " + label + " " + JSON.stringify(result))
  }
  if (results.some((result) => result.outcome !== "success")) process.exitCode = 1
}).catch((error) => {
  console.error("[모델 확인] " + getTranslationErrorMessage(error))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
