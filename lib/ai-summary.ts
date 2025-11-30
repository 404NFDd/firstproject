/**
 * Google Gemini API를 사용한 뉴스 요약 기능
 */

import { prisma } from "@/lib/prisma"

interface NewsArticle {
  id: string
  title: string
  description?: string | null
  content?: string | null
  source: string
  category: string
  publishedAt: Date
}

interface SummarizedArticle {
  title: string
  summary: string
  category: string
  source: string
  publishedAt: Date
}

/**
 * 단일 기사를 요약합니다 (DB에 저장된 요약이 있으면 사용)
 */
export async function summarizeArticle(article: NewsArticle): Promise<string> {
  // DB에 저장된 요약이 있는지 확인
  const existingSummary = await prisma.newsSummary.findUnique({
    where: { newsId: article.id },
    select: { summary: true },
  })

  if (existingSummary) {
    return existingSummary.summary
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn("⚠️  GEMINI_API_KEY가 설정되지 않아 원문을 반환합니다.")
    const fallbackSummary = article.description || article.title || ""
    // DB에 저장 (다음번에는 사용 가능)
    if (fallbackSummary && article.id) {
      try {
        await prisma.newsSummary.upsert({
          where: { newsId: article.id },
          update: { summary: fallbackSummary },
          create: {
            newsId: article.id,
            summary: fallbackSummary,
          },
        })
      } catch (error) {
        // 무시 (뉴스가 아직 DB에 없을 수 있음)
      }
    }
    return fallbackSummary
  }

  try {
    const textToSummarize = [
      article.title,
      article.description || "",
      article.content || "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .substring(0, 8000) // Gemini API 토큰 제한 고려

    const prompt = `다음 뉴스 기사를 2-3문장으로 간결하게 요약해주세요. 핵심 내용만 포함하고, 객관적이고 명확하게 작성해주세요.

기사:
${textToSummarize}

요약:`

    // v1beta API 사용 - 최신 모델
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(30000), // 30초 타임아웃
      }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error(`⚠️  Gemini API 요청 실패: ${response.status} ${response.statusText}`)
      if (errorText) {
        console.error(`   오류 내용:`, errorText.substring(0, 200))
      }
      return article.description || article.title || ""
    }

    const data = await response.json()
    const summary =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      article.description ||
      article.title ||
      ""

    // DB에 요약 저장
    if (summary && article.id) {
      try {
        await prisma.newsSummary.upsert({
          where: { newsId: article.id },
          update: { summary },
          create: {
            newsId: article.id,
            summary,
          },
        })
      } catch (error) {
        // 무시 (뉴스가 아직 DB에 없을 수 있음)
        console.warn("⚠️  요약 저장 실패 (뉴스가 아직 DB에 없을 수 있음):", article.id)
      }
    }

    return summary
  } catch (error) {
    console.error("⚠️  요약 중 오류 발생:", error)
    if (error instanceof Error) {
      console.error(`   오류 메시지: ${error.message}`)
    }
    const fallbackSummary = article.description || article.title || ""

    // 오류 발생 시에도 fallback 요약을 DB에 저장
    if (fallbackSummary && article.id) {
      try {
        await prisma.newsSummary.upsert({
          where: { newsId: article.id },
          update: { summary: fallbackSummary },
          create: {
            newsId: article.id,
            summary: fallbackSummary,
          },
        })
      } catch (error) {
        // 무시
      }
    }

    return fallbackSummary
  }
}

/**
 * 여러 기사를 카테고리별로 그룹화하고 요약합니다
 */
export async function summarizeNewsByCategory(
  articles: NewsArticle[]
): Promise<Record<string, SummarizedArticle[]>> {
  const categorized: Record<string, NewsArticle[]> = {}

  // 카테고리별로 그룹화
  for (const article of articles) {
    const category = article.category || "general"
    if (!categorized[category]) {
      categorized[category] = []
    }
    categorized[category].push(article)
  }

  // 각 카테고리의 기사들을 요약
  const summarized: Record<string, SummarizedArticle[]> = {}

  for (const [category, categoryArticles] of Object.entries(categorized)) {
    // 병렬로 요약 처리 (너무 많으면 순차 처리)
    const summaries = await Promise.all(
      categoryArticles.slice(0, 20).map(async (article) => {
        const summary = await summarizeArticle(article)
        return {
          title: article.title,
          summary,
          category: article.category,
          source: article.source,
          publishedAt: article.publishedAt,
        }
      })
    )

    summarized[category] = summaries
  }

  return summarized
}

/**
 * 카테고리별 요약된 기사들을 HTML로 포맷팅합니다
 */
export function formatSummarizedNewsHTML(
  summarized: Record<string, SummarizedArticle[]>
): string {
  const categoryLabels: Record<string, string> = {
    general: "일반",
    business: "비즈니스",
    technology: "기술",
    developer: "개발자",
    entertainment: "엔터테인먼트",
    health: "건강",
    science: "과학",
    sports: "스포츠",
  }

  let html = ""

  for (const [category, articles] of Object.entries(summarized)) {
    if (articles.length === 0) continue

    const categoryLabel = categoryLabels[category] || category
    html += `
      <div style="margin-bottom: 40px;">
        <h2 style="margin: 0 0 20px 0; color: #007bff; font-size: 20px; font-weight: bold; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
          📰 ${categoryLabel}
        </h2>
    `

    for (const article of articles) {
      html += `
        <div style="margin-bottom: 25px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa;">
          <h3 style="margin: 0 0 12px 0; color: #333; font-size: 18px; font-weight: bold; line-height: 1.4;">
            ${escapeHtml(article.title)}
          </h3>
          <p style="margin: 0 0 12px 0; color: #555; font-size: 15px; line-height: 1.6;">
            ${escapeHtml(article.summary)}
          </p>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
            <p style="margin: 0; color: #999; font-size: 12px;">
              <strong>출처:</strong> ${escapeHtml(article.source)} | 
              <strong>발행일:</strong> ${new Date(article.publishedAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
            </p>
          </div>
        </div>
      `
    }

    html += `</div>`
  }

  return html
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

