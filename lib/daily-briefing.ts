/**
 * 일일 브리핑 메일 전송 기능
 */

import { EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email-service"
import { summarizeNewsByCategory, formatSummarizedNewsHTML } from "@/lib/ai-summary"
import { escapeHtml } from "@/lib/html"
import { PUBLISHED_TRANSLATION_FILTER, getListTranslations } from "@/lib/news-translation"
import { isCurationArticle } from "@/lib/news-curation"

/**
 * 지난 24시간 동안의 주요 뉴스를 조회합니다
 * Input: 없음
 * Output: 우선순위/발행시각 기준으로 정렬된 뉴스 배열(최대 50개)
 */
export async function getDailyNews() {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  const news = await prisma.news.findMany({
    where: {
      source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] },
      ...PUBLISHED_TRANSLATION_FILTER,
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

  const curated = await getListTranslations(news.filter(isCurationArticle))
  return news.map((article) => {
    const summary = curated.get(article.id)
    return summary?.isSummary ? { ...article, title: summary.title, curatedSummary: summary.preview } : article
  })
}

/**
 * 메일 구독 사용자들에게 일일 브리핑을 전송합니다
 * Input: 없음
 * Output: 전송 성공/실패 집계 객체
 */
export function getBriefingDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
}

export async function markInterruptedBriefings(now = new Date()) {
  return prisma.briefingDelivery.updateMany({
    where: { status: "processing", startedAt: { lte: new Date(now.getTime() - 30 * 60 * 1000) } },
    data: { status: "unknown", error: "실행이 중단되어 발송 결과를 확인할 수 없습니다. 자동 재발송을 보류합니다." },
  })
}

async function claimDelivery(userId: string, dateKey: string) {
  try {
    return await prisma.briefingDelivery.create({ data: { userId, dateKey } })
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error
    // 명시적으로 실패한 발송만 원자적으로 다시 예약합니다.
    const claim = await prisma.briefingDelivery.updateMany({
      where: { userId, dateKey, status: "failed" },
      data: { status: "processing", startedAt: new Date(), attempts: { increment: 1 }, error: null },
    })
    return claim.count ? prisma.briefingDelivery.findUnique({ where: { userId_dateKey: { userId, dateKey } } }) : null
  }
}

export async function sendDailyBriefing(userId?: string) {
  const reservedIds: string[] = []
  const counts = { sent: 0, failed: 0, total: 0, skipped: 0, uncertain: 0 }
  let sendStarted = false
  try {
    const dateKey = getBriefingDateKey()
    // 로그인 사용자의 테스트 메일은 정기 발송 기록을 소비하지 않습니다.
    if (!userId) await markInterruptedBriefings()
    const subscribers = await prisma.user.findMany({
      where: userId ? { id: userId } : { emailSubscription: 1 },
      select: { id: true, email: true, name: true },
    })
    counts.total = subscribers.length
    if (!subscribers.length) return { success: true, ...counts }
    const news = await getDailyNews()
    if (!news.length) return { success: true, ...counts, skipped: subscribers.length }

    // 요약 생성도 예약 이후 실행하여 동시 호출이 같은 사용자의 메일을 준비하지 않도록 합니다.
    const targets = []
    for (const subscriber of subscribers) {
      const delivery = userId ? null : await claimDelivery(subscriber.id, dateKey)
      if (!userId && !delivery) {
        const previous = await prisma.briefingDelivery.findUnique({
          where: { userId_dateKey: { userId: subscriber.id, dateKey } }, select: { status: true },
        })
        if (previous?.status === "unknown") counts.uncertain++
        else counts.skipped++
        continue
      }
      targets.push({ subscriber, delivery })
      if (delivery) reservedIds.push(delivery.id)
    }
    if (!targets.length) return { success: counts.uncertain === 0, ...counts, ...(counts.uncertain ? { error: "발송 결과 확인이 필요한 대상이 있습니다." } : {}) }

    const summarized = await summarizeNewsByCategory(news)
    const newsHTML = formatSummarizedNewsHTML(summarized)
    const totalArticles = Object.values(summarized).reduce((sum, articles) => sum + articles.length, 0)

    for (const { subscriber, delivery } of targets) {
      try {
        const html = generateBriefingEmailHTML(newsHTML, subscriber.name || subscriber.email.split("@")[0], totalArticles)
        sendStarted = true
        const result = await sendEmail({
          to: subscriber.email,
          subject: `NewsHub 일일 브리핑 - ${dateKey}`,
          html,
        })
        if (delivery) {
          // SMTP 발송 후 DB 기록이 실패하면 processing을 유지하여 자동 재발송을 막습니다.
          await prisma.briefingDelivery.update({
            where: { id: delivery.id },
            data: {
              status: result.deliveryStatus,
              sentAt: result.success ? new Date() : null,
              messageId: result.success ? result.messageId : null,
              error: result.success ? null : result.error?.slice(0, 1000),
            },
          })
        }
        if (result.success) counts.sent++
        else if (result.deliveryStatus === "unknown") counts.uncertain++
        else counts.failed++
      } catch {
        // 발송 단계의 예외는 SMTP 수락 여부가 불명확하므로 재시도 가능 상태로 돌리지 않습니다.
        counts.uncertain++
      }
    }
    return {
      success: counts.failed === 0 && counts.uncertain === 0,
      ...counts,
      ...(counts.failed || counts.uncertain ? { error: `발송 실패 ${counts.failed}건, 결과 확인 필요 ${counts.uncertain}건입니다.` } : {}),
    }
  } catch {
    // SMTP 요청 전의 준비 실패는 안전하게 재시도할 수 있습니다.
    if (!sendStarted && reservedIds.length) {
      counts.failed += reservedIds.length
      await prisma.briefingDelivery.updateMany({
        where: { id: { in: reservedIds }, status: "processing" },
        data: { status: "failed", error: "메일 발송 전 브리핑 준비에 실패했습니다." },
      }).catch(() => {})
    }
    return { success: false, ...counts, error: "일일 브리핑 준비 중 오류가 발생했습니다." }
  }
}

/**
 * 일일 브리핑 이메일 HTML 생성
 * Input: 요약 HTML, 사용자명, 총 기사 수
 * Output: 최종 이메일 본문 HTML 문자열
 */
function generateBriefingEmailHTML(newsHTML: string, userName: string, totalArticles: number) {
  const date = new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
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
              안녕하세요, <strong>${escapeHtml(userName)}</strong>님!<br>
              지난 24시간의 종합 뉴스에서 선택한 <strong>${totalArticles}개</strong> 기사를 전해드립니다.<br>
              기사마다 AI 요약, 원문 발췌 또는 제목만 제공 여부를 표시합니다. 원문 링크에서 전체 내용을 확인하세요.
            </p>
          </div>
          ${newsHTML}
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} NewsHub. All rights reserved.</p>
          <p>이 이메일은 자동 발송되었습니다. 답장은 처리되지 않습니다.</p>
          <div class="unsubscribe">
            <p>
              <a href="${escapeHtml(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000")}/profile">프로필에서 구독 설정 변경</a>
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

