import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
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
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@newshub.com",
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    }

    const result = await transporter.sendMail(mailOptions)
    console.log("[v0] Email sent successfully:", result.messageId)
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error("[v0] Error sending email:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function sendNewsEmail(email: string, news: any[], title = "NewsHub - 오늘의 뉴스") {
  const newsHtml = news
    .map(
      (article) => `
    <div style="margin-bottom: 30px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px; font-weight: bold;">
        ${article.title}
      </h3>
      <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">
        ${article.description || ""}
      </p>
      <p style="margin: 0 0 10px 0; color: #999; font-size: 12px;">
        <strong>출처:</strong> ${article.source} | <strong>작성자:</strong> ${article.author || "Unknown"}
      </p>
      <p style="margin: 0 0 10px 0; color: #999; font-size: 12px;">
        ${new Date(article.publishedAt).toLocaleDateString("ko-KR")}
      </p>
    </div>
  `,
    )
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
          <p style="margin: 10px 0 0 0; color: #666;">${title}</p>
        </div>
        <div class="content">
          ${newsHtml}
        </div>
        <div class="footer">
          <p>© 2025 NewsHub. All rights reserved.</p>
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
