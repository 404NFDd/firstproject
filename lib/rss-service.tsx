import { prisma } from "@/lib/prisma"

export async function generateRSSFeed(baseUrl: string) {
  try {
    const news = await prisma.news.findMany({
      orderBy: { publishedAt: "desc" },
      take: 50,
    })

    const rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>NewsHub - 뉴스 피드</title>
    <link>${baseUrl}</link>
    <description>최신 뉴스를 RSS로 받아보세요</description>
    <language>ko-kr</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${news
      .map(
        (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${baseUrl}/news/${article.id}</link>
      <description>${escapeXml(article.description || "")}</description>
      <content:encoded><![CDATA[${article.content || article.description || ""}]]></content:encoded>
      <author>${escapeXml(article.author || "Unknown")}</author>
      <category>${escapeXml(article.category)}</category>
      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
      <guid>${baseUrl}/news/${article.id}</guid>
      ${article.imageUrl ? `<image>${escapeXml(article.imageUrl)}</image>` : ""}
      <source>${escapeXml(article.source)}</source>
    </item>
  `,
      )
      .join("")}
  </channel>
</rss>`

    return rssXml
  } catch (error) {
    console.error("[v0] Error generating RSS feed:", error)
    return null
  }
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "&":
        return "&amp;"
      case "'":
        return "&apos;"
      case '"':
        return "&quot;"
      default:
        return c
    }
  })
}
