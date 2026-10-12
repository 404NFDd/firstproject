"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, ArrowUpRight, ChevronDown } from "lucide-react"
import { decodeHtmlEntities } from "@/lib/text"
import { getArticleContent } from "@/lib/article-content"
import { TECH_NEWS_CATEGORY_VALUES, getNewsCategoryLabel } from "@/lib/news-categories"
import { getSafeNewsUrl } from "@/lib/news-links"

interface NewsCardProps {
  id: string; title: string; originalTitle?: string; isTranslated?: boolean
  description: string; content?: string | null; preview?: string
  previewType?: "summary" | "description" | "content" | "none"
  category?: string | null; author?: string | null; imageUrl?: string; sourceUrl?: string
  source: string; publishedAt: string; onSendEmail?: (newsId: string) => void
}

export function NewsCard({ id, title, originalTitle, isTranslated, description, content,
  preview: listPreview, previewType, category, author, sourceUrl, source, publishedAt, onSendEmail }: NewsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const text = getArticleContent({ title, description, content })
  const preview = listPreview ?? (text.description || text.content.split(/\n\s*\n/)[0])
  const sourceLabel = decodeHtmlEntities(source).trim() || "출처 미확인"
  const originalUrl = getSafeNewsUrl(sourceUrl)
  const isTechFeed = TECH_NEWS_CATEGORY_VALUES.some((value) => value === category)
  const isSummary = previewType === "summary"
  const isExcerpt = previewType === "content" || (!previewType && !text.description && Boolean(text.content))
  const date = new Date(publishedAt).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })

  return (
    <article className="group min-w-0 py-5 pl-7 sm:pl-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
        <span>{getNewsCategoryLabel(category)}</span>
        <span aria-label={`출처: ${sourceLabel}`} className="break-all">{sourceLabel}</span>
        <time dateTime={publishedAt} title={isTechFeed ? "피드가 제공한 게시 또는 갱신 시각, 한국 시간" : "한국 시간 기준"}>{isTechFeed ? "게시·갱신" : "발행"} {date}</time>
        {isTranslated && <span title={originalTitle}>자동 번역</span>}
      </div>
      <h3 className="text-base sm:text-lg font-semibold leading-snug break-words">
        <Link href={`/news/${id}`} className="hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{text.title}</Link>
      </h3>
      <p className={`mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line break-words ${expanded ? "" : "line-clamp-2"}`}>
        {preview || "소개 문구가 없는 소식입니다. 상세 페이지에서 출처 링크를 확인하세요."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {isSummary && <span className="font-medium text-foreground">AI 요약</span>}
        {!isSummary && isExcerpt && <span>본문 발췌</span>}
        {author && <span>작성: {decodeHtmlEntities(author)}</span>}
        {preview && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="inline-flex items-center gap-1 hover:text-foreground py-1">
          {expanded ? "접기" : isSummary ? "요약 펼치기" : "소개 펼치기"}
          <ChevronDown className={`h-3 w-3 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>}
        {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground py-1">
          원본보기<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only"> (새 탭에서 열기)</span>
        </a>}
        {onSendEmail && <button type="button" onClick={() => onSendEmail(id)} aria-label={`${text.title} 이메일로 발송`} className="inline-flex items-center gap-1 hover:text-foreground py-1">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />이메일
        </button>}
      </div>
    </article>
  )
}
