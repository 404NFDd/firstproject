import { parseDocument, DomUtils } from "htmlparser2"

type HtmlNode = ReturnType<typeof parseDocument>["children"][number]
const OMIT = new Set(["script", "style", "noscript", "nav", "aside", "footer", "form", "button", "svg", "iframe"])
const BLOCK = new Set(["p", "div", "section", "article", "main", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "tr", "figure", "figcaption"])

function nodeText(node: HtmlNode, pre = false, sourceUrl?: string): string {
  if (node.type === "text") return pre ? node.data : node.data.replace(/\s+/g, " ")
  if (!("children" in node)) return ""
  if (!("name" in node)) return node.children.map((child) => nodeText(child, pre, sourceUrl)).join("")
  if (OMIT.has(node.name) || node.attribs["aria-hidden"] === "true") return ""
  if (node.name !== "pre" && node.attribs.class?.split(/\s+/).includes("not-prose")) {
    // 복사 버튼 등은 제외하되 공식 글의 코드 블록은 보존합니다.
    return DomUtils.findAll((child) => child.name === "pre", node.children).map((child) => nodeText(child, true, sourceUrl)).join("\n\n")
  }
  if (node.name === "br") return "\n"
  const text = node.children.map((child) => nodeText(child, pre || node.name === "pre", sourceUrl)).join("")
  if (sourceUrl && node.name === "a" && node.attribs.href) {
    try {
      const url = new URL(node.attribs.href, sourceUrl)
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return `${text} (${url.href})`
    } catch { /* 올바르지 않은 링크는 텍스트만 남깁니다. */ }
  }
  if (node.name === "td" || node.name === "th") return text + "\t"
  if (node.name === "li") return "\n- " + text.trim() + "\n"
  return BLOCK.has(node.name) ? "\n\n" + text + "\n\n" : text
}

function clean(node: HtmlNode, sourceUrl?: string): string | undefined {
  return nodeText(node, false, sourceUrl).replace(/\r\n?/g, "\n").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || undefined
}

// 피드의 전체 본문만 전달합니다. 소개나 제목을 본문으로 합성하지 않습니다.
export function feedContentText(html: unknown, sourceUrl?: string): string | undefined {
  return typeof html === "string" ? clean(parseDocument(html), sourceUrl) : undefined
}

// 구조를 확인한 공식 출처만 원문 보강을 허용합니다.
export function supportsArticleContent(sourceId: string, sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false
    switch (sourceId) {
      case "hugging-face": return url.hostname === "huggingface.co" && url.pathname.startsWith("/blog/")
      case "nodejs": return url.hostname === "nodejs.org" && url.pathname.startsWith("/en/blog/")
      case "nextjs": return url.hostname === "nextjs.org" && url.pathname.startsWith("/blog/")
      case "python": return url.hostname === "blog.python.org" && /^\/\d{4}\/\d{2}\//.test(url.pathname)
      case "java": return url.hostname === "inside.java" && /^\/\d{4}\/\d{2}\/\d{2}\//.test(url.pathname)
      case "mysql": return url.hostname === "blogs.oracle.com" && url.pathname.startsWith("/mysql/")
      default: return false
    }
  } catch { return false }
}

export function sourceContentText(sourceId: string, html: string, sourceUrl?: string): string | undefined {
  const dom = parseDocument(html)
  const root = DomUtils.findOne((node) => {
    const classes = node.attribs.class?.split(/\s+/) ?? []
    switch (sourceId) {
      case "hugging-face": return classes.includes("blog-content")
      case "nodejs": return node.name === "main" && node.attribs.id === "main"
      case "nextjs": return classes.includes("next-prose")
      case "python": return node.name === "article" && classes.includes("prose")
      case "java": return classes.some((name) => /^ArticlePage-[\w-]+-content$/.test(name))
      case "mysql": return classes.includes("post-content")
      default: return false
    }
  }, dom.children, true)
  return root ? clean(root, sourceUrl) : undefined
}
