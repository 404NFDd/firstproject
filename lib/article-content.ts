import { decodeHtmlEntities } from "@/lib/text"

interface ArticleText {
  title: string
  description?: string | null
  content?: string | null
}

// 소개 문구가 제목 또는 본문 앞부분을 반복할 때만 숨기며 본문은 그대로 보존한다.
export function getArticleContent(article: ArticleText) {
  const title = decodeHtmlEntities(article.title).trim()
  const content = decodeHtmlEntities(article.content).trim()
  const description = decodeHtmlEntities(article.description).trim()
  const comparable = (text: string) => text.replace(/\s+/g, " ").trim()
  const intro = comparable(description)
  const repeated = intro && (intro === comparable(title) || comparable(content).startsWith(intro))

  return { title, description: repeated ? "" : description, content }
}