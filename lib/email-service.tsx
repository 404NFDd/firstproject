import nodemailer from "nodemailer"
import type { News } from "@prisma/client"
import { escapeHtml } from "@/lib/html"
import { getArticleContent } from "@/lib/article-content"
import { getNewsCategoryLabel, TECH_NEWS_CATEGORY_VALUES } from "@/lib/news-categories"
import { getSafeNewsUrl } from "@/lib/news-links"
import { decodeHtmlEntities } from "@/lib/text"

// SMTP 설정 검증
const smtpHost = process.env.SMTP_HOST
if (!smtpHost) {
  console.warn("⚠️  SMTP_HOST가 설정되지 않았습니다. 이메일 전송이 실패할 수 있습니다.")
}

const transporter = nodemailer.createTransport({
  host: smtpHost || "localhost",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: smtpHost
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
  // 연결 타임아웃 설정
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
})

export interface EmailOptions {
  to: string
  subject: string
  html: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
}

export async function sendEmail(options: EmailOptions) {
  // SMTP 설정 확인
  if (!process.env.SMTP_HOST) {
    const errorMsg = "SMTP_HOST가 설정되지 않았습니다. .env 파일에 SMTP 설정을 추가해주세요."
    console.error(`[v0] ${errorMsg}`)
    return { success: false, deliveryStatus: "failed" as const, error: errorMsg }
  }

  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@newshub.com",
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    }

    const result = await transporter.sendMail(mailOptions)
    console.log("[v0] Email sent successfully:", result.messageId)
    if (result.accepted?.length === 0) {
      return { success: false, deliveryStatus: "failed" as const, error: "SMTP 서버가 수신자를 거절했습니다." }
    }
    return { success: true, deliveryStatus: "sent" as const, messageId: result.messageId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error("[v0] Error sending email:", errorMessage)
    
    const smtpError = error as { code?: string; command?: string; responseCode?: number }
    // 서버의 명시적 거절 또는 DATA 이전 실패만 안전하게 다시 시도할 수 있습니다.
    const knownFailure = Boolean(smtpError.responseCode && smtpError.responseCode >= 400) ||
      ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EAUTH"].includes(smtpError.code || "") ||
      ["CONN", "EHLO", "HELO", "AUTH", "MAIL FROM", "RCPT TO"].includes(smtpError.command || "")
    const deliveryStatus = knownFailure ? "failed" as const : "unknown" as const

    // 더 명확한 오류 메시지 제공
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("::1")) {
      return {
        success: false,
        deliveryStatus,
        error: `SMTP 서버 연결 실패. SMTP_HOST="${process.env.SMTP_HOST}" 설정을 확인해주세요.`,
      }
    }
    
    return { success: false, deliveryStatus, error: errorMessage }
  }
}

export async function sendNewsEmail(email: string, news: Array<News & { isAiSummary?: boolean }>, title = "NewsHub - 오늘의 뉴스") {
  const newsHtml = news
    .map((article) => {
      const text = getArticleContent(article)
      const excerptText = text.description || text.content
      const excerpt = Array.from(excerptText).slice(0, 500).join("") + (Array.from(excerptText).length > 500 ? "…" : "")
      const excerptLabel = article.isAiSummary ? "AI 요약" : text.description ? "원문 발췌" : text.content ? "본문 발췌" : "제목만 제공"
      const sourceUrl = getSafeNewsUrl(article.sourceUrl)
      const author = decodeHtmlEntities(article.author).trim()
      const isTechFeed = TECH_NEWS_CATEGORY_VALUES.some((value) => value === article.category)
      return `
        <div style="margin-bottom: 30px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <p style="margin: 0 0 8px 0; color: #666; font-size: 12px;">${escapeHtml(getNewsCategoryLabel(article.category))} · ${excerptLabel}</p>
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px; font-weight: bold;">${escapeHtml(text.title)}</h3>
          <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">${escapeHtml(excerpt || "표시할 기사 소개가 없습니다.")}</p>
          <p style="margin: 0 0 10px 0; color: #999; font-size: 12px;">
            <strong>출처:</strong> ${escapeHtml(decodeHtmlEntities(article.source).trim() || "출처 미확인")}${author ? ` | <strong>작성:</strong> ${escapeHtml(author)}` : ""}
          </p>
          <p style="margin: 0 0 10px 0; color: #999; font-size: 12px;">
            ${isTechFeed ? "게시·갱신" : "발행"}: ${new Date(article.publishedAt).toLocaleDateString("ko-KR", {
              timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
            })} (한국 시간)
          </p>
          ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" style="color: #007bff;">${isTechFeed ? "출처에서 읽기" : "기사 원문 보기"}</a>` : '<p style="color: #999; font-size: 12px;">원문 링크를 확인할 수 없습니다.</p>'}
        </div>
      `
    })
    .join("")

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333; }
        .container { max-width: 600px; margin: 0 auto; background-color: #fff; padding: 30px; border-radius: 8px; }
        .header { text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { margin: 0; color: #007bff; font-size: 24px; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>NewsHub</h1>
          <p style="margin: 10px 0 0 0; color: #666;">${escapeHtml(title)}</p>
        </div>
        <div class="content">
          ${newsHtml}
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} NewsHub. All rights reserved.</p>
          <p>이 이메일은 자동 발송되었습니다. 답장은 처리되지 않습니다.</p>
        </div>
      </div>
    </body>
    </html>
  `

  return sendEmail({
    to: email,
    subject: title,
    html: htmlContent,
  })
}
