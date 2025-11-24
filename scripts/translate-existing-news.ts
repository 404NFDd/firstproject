import { prisma } from "../lib/prisma"
import { translateToKorean } from "../lib/news-service"

async function translateExistingNews() {
  try {
    console.log("🔄 기존 뉴스 기사 번역을 시작합니다...")

    // 번역되지 않은 기사만 가져오기 (isTranslated = 0)
    const untranslatedNews = await prisma.news.findMany({
      where: {
        isTranslated: 0,
      },
      select: {
        id: true,
        title: true,
        description: true,
        content: true,
        source: true,
      },
    })

    console.log(`📰 번역할 기사 수: ${untranslatedNews.length}개`)

    if (untranslatedNews.length === 0) {
      console.log("✅ 번역할 기사가 없습니다.")
      return
    }

    let translatedCount = 0
    let errorCount = 0

    // 각 기사를 순차적으로 번역 (API 호출 제한 고려)
    for (let i = 0; i < untranslatedNews.length; i++) {
      const news = untranslatedNews[i]
      console.log(`\n[${i + 1}/${untranslatedNews.length}] 번역 중: ${news.title.substring(0, 50)}...`)

      try {
        // 제목, 설명, 내용 번역
        const translatedTitle = await translateToKorean(news.title)
        const translatedDescription = news.description
          ? await translateToKorean(news.description)
          : null
        const translatedContent = news.content ? await translateToKorean(news.content) : null

        // 번역 결과가 원문과 다르면 업데이트
        if (
          translatedTitle &&
          (translatedTitle !== news.title ||
            translatedDescription !== news.description ||
            translatedContent !== news.content)
        ) {
          await prisma.news.update({
            where: { id: news.id },
            data: {
              title: translatedTitle,
              description: translatedDescription || news.description,
              content: translatedContent || news.content,
              isTranslated: 1, // 번역 완료 플래그 설정
            },
          })

          translatedCount++
          console.log(`   ✓ 번역 완료`)
        } else {
          // 번역 실패 또는 원문과 동일한 경우에도 플래그만 설정 (이미 한국어일 수 있음)
          await prisma.news.update({
            where: { id: news.id },
            data: {
              isTranslated: 1,
            },
          })
          console.log(`   ⚠ 번역 결과가 원문과 동일하거나 번역 실패 (이미 한국어일 수 있음)`)
        }

        // API 호출 제한을 고려하여 약간의 지연 추가 (선택사항)
        if (i < untranslatedNews.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100)) // 100ms 지연
        }
      } catch (error) {
        errorCount++
        console.error(`   ❌ 번역 실패:`, error)
        // 오류가 발생해도 계속 진행
      }
    }

    console.log("\n✅ 번역 작업이 완료되었습니다!")
    console.log(`   - 총 기사 수: ${untranslatedNews.length}개`)
    console.log(`   - 번역 완료: ${translatedCount}개`)
    console.log(`   - 오류 발생: ${errorCount}개`)
  } catch (error) {
    console.error("❌ 번역 작업 중 오류 발생:", error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

translateExistingNews()

