/**
 * 일일 브리핑 메일 전송 기능
 */

import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email-service"
import { summarizeNewsByCategory, formatSummarizedNewsHTML } from "@/lib/ai-summary"

/**
 * 지난 24시간 동안의 주요 뉴스를 조회합니다
 * Input: 없음
 * Output: 우선순위/발행시각 기준으로 정렬된 뉴스 배열(최대 50개)
 */
export async function getDailyNews() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const news = await prisma.news.findMany({
    where: {
      publishedAt: {
        gte: yesterday,
        lte: today,
      },
    },
    orderBy: [
      { priority: "desc" },
      { publishedAt: "desc" },
    ],
    take: 50, // 상위 50개 기사만 선택
  })

  return news
}

/**
 * 메일 구독 사용자들에게 일일 브리핑을 전송합니다
 * Input: 없음
 * Output: 전송 성공/실패 집계 객체
 */
export async function sendDailyBriefing() {
  try {
    // 메일 구독 활성화된 사용자 조회
    const subscribers = await prisma.user.findMany({
      where: {
        emailSubscription: 1,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    })

    if (subscribers.length === 0) {
      console.log("📧 메일 구독자가 없습니다.")
      return {
        success: true,
        sent: 0,
        skipped: 0,
      }
    }

    // 지난 24시간 뉴스 조회
    const news = await getDailyNews()

    if (news.length === 0) {
      console.log("📰 전송할 뉴스가 없습니다.")
      return {
        success: true,
        sent: 0,
        skipped: subscribers.length,
      }
    }

    // 뉴스 요약
    console.log(`🤖 ${news.length}개 기사를 요약 중...`)
    const summarized = await summarizeNewsByCategory(news)
    const newsHTML = formatSummarizedNewsHTML(summarized)

    const totalArticles = Object.values(summarized).reduce(
      (sum, articles) => sum + articles.length,
      0
    )

    // 각 구독자에게 메일 전송
    let sent = 0
    let failed = 0

    for (const subscriber of subscribers) {
      try {
        const userName = subscriber.name || subscriber.email.split("@")[0]
        const htmlContent = generateBriefingEmailHTML(newsHTML, userName, totalArticles)

        const result = await sendEmail({
          to: subscriber.email,
          subject: `NewsHub 일일 브리핑 - ${new Date().toLocaleDateString("ko-KR", {
            month: "long",
            day: "numeric",
          })}`,
          html: htmlContent,
        })

        if (result.success) {
          sent++
          console.log(`✅ ${subscriber.email}에게 메일 전송 완료`)
        } else {
          failed++
          console.error(`❌ ${subscriber.email} 메일 전송 실패:`, result.error)
        }
      } catch (error) {
        failed++
        console.error(`❌ ${subscriber.email} 메일 전송 중 오류:`, error)
      }
    }

    return {
      success: true,
      sent,
      failed,
      total: subscribers.length,
    }
  } catch (error) {
    console.error("❌ 일일 브리핑 전송 중 오류:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * 일일 브리핑 이메일 HTML 생성
 * Input: 요약 HTML, 사용자명, 총 기사 수
 * Output: 최종 이메일 본문 HTML 문자열
 */
function generateBriefingEmailHTML(newsHTML: string, userName: string, totalArticles: number) {
  const date = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  })

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background-color: #f5f5f5; 
          color: #333; 
          line-height: 1.6;
          margin: 0;
          padding: 0;
        }
        .container { 
          max-width: 600px; 
          margin: 0 auto; 
          background-color: #fff; 
          padding: 0;
        }
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 { 
          margin: 0 0 10px 0; 
          font-size: 28px; 
          font-weight: bold;
        }
        .header p { 
          margin: 0; 
          font-size: 16px; 
          opacity: 0.9;
        }
        .content { 
          padding: 30px;
        }
        .intro {
          background-color: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 30px;
          border-left: 4px solid #667eea;
        }
        .intro p {
          margin: 0;
          color: #555;
          font-size: 15px;
        }
        .footer { 
          text-align: center; 
          margin-top: 40px; 
          padding: 30px;
          border-top: 1px solid #e0e0e0; 
          background-color: #fafafa;
        }
        .footer p { 
          margin: 5px 0;
          color: #999; 
          font-size: 12px; 
        }
        .unsubscribe {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e0e0e0;
        }
        .unsubscribe a {
          color: #667eea;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📰 NewsHub</h1>
          <p>${date} 일일 브리핑</p>
        </div>
        <div class="content">
          <div class="intro">
            <p>
              안녕하세요, <strong>${userName}</strong>님!<br>
              어제부터 오늘까지 총 <strong>${totalArticles}개</strong>의 주요 뉴스를 요약해드립니다.
            </p>
          </div>
          ${newsHTML}
        </div>
        <div class="footer">
          <p>© 2025 NewsHub. All rights reserved.</p>
          <p>이 이메일은 자동 발송되었습니다. 답장은 처리되지 않습니다.</p>
          <div class="unsubscribe">
            <p>
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/profile">프로필에서 구독 설정 변경</a>
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

