"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Mail, ArrowUpRight, ChevronDown } from "lucide-react"
import { decodeHtmlEntities } from "@/lib/text"
import { getArticleContent } from "@/lib/article-content"
import { TECH_NEWS_CATEGORY_VALUES, getNewsCategoryLabel } from "@/lib/news-categories"
import { getSafeNewsUrl } from "@/lib/news-links"

interface NewsCardProps {
  id: string; title: string
  description: string; content?: string | null; preview?: string
  previewType?: "summary" | "description" | "content" | "none"
  category?: string | null; author?: string | null; imageUrl?: string; sourceUrl?: string
  source: string; publishedAt: string; onSendEmail?: (newsId: string) => void
}

export function NewsCard({ id, title, description, content,
  preview: listPreview, previewType, category, author, imageUrl, sourceUrl, source, publishedAt, onSendEmail }: NewsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const previewMeasureRef = useRef<HTMLParagraphElement>(null)
  const previewId = useId()
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const text = getArticleContent({ title, description, content })
  const preview = listPreview ?? (text.description || text.content.split(/\n\s*\n/)[0])
  useEffect(() => {
    const element = previewMeasureRef.current
    if (!element) return
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
      setCanExpand(element.scrollHeight > lineHeight * 2 + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [preview])
  const sourceLabel = decodeHtmlEntities(source).trim() || "출처 미확인"
  const originalUrl = getSafeNewsUrl(sourceUrl)
  const thumbnailUrl = getSafeNewsUrl(imageUrl)
  const showThumbnail = Boolean(thumbnailUrl && failedImage !== thumbnailUrl)
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
      </div>
      <div className={`grid items-start gap-x-3 gap-y-3 sm:gap-x-4 ${showThumbnail ? "grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)]" : "grid-cols-1"}`}>
        {thumbnailUrl && showThumbnail && (
          <Link href={`/news/${id}`} aria-label={`${text.title} 상세 보기`}
            className="relative block h-20 w-28 overflow-hidden rounded-md bg-muted sm:row-span-2 sm:h-28 sm:w-40">
            <Image src={thumbnailUrl} alt="" fill unoptimized loading="lazy" sizes="(min-width: 640px) 160px, 112px"
              className="object-cover" onError={() => setFailedImage(thumbnailUrl)} />
          </Link>
        )}
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold leading-snug break-words">
            <Link href={`/news/${id}`} className="hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{text.title}</Link>
          </h3>
          <div className="relative mt-2">
            <p ref={previewMeasureRef} aria-hidden="true" className="invisible pointer-events-none absolute inset-x-0 top-0 line-clamp-2 text-sm leading-relaxed whitespace-pre-line break-words">
              {preview}
            </p>
            <div className="flex items-end gap-2">
              <p id={previewId} className={`min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground whitespace-pre-line break-words ${expanded ? "" : "line-clamp-2"}`}>
                {preview || "소개 문구가 없는 소식입니다. 상세 페이지에서 출처 링크를 확인하세요."}
              </p>
              {canExpand && <button type="button" aria-controls={previewId} aria-expanded={expanded}
                aria-label={expanded ? "접기" : isSummary ? "요약 펼치기" : "소개 펼치기"}
                onClick={() => setExpanded(!expanded)}
                className="inline-flex shrink-0 items-center gap-0.5 py-0.5 text-xs text-primary transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {expanded ? "접기" : "펼치기"}
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>}
            </div>
          </div>
        </div>
        <div className={`col-span-full flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${showThumbnail ? "sm:col-span-1 sm:col-start-2" : ""}`}>
          {isSummary && <span className="font-medium text-foreground">AI 요약</span>}
          {!isSummary && isExcerpt && <span>본문 발췌</span>}
          {author && <span className="break-words">작성: {decodeHtmlEntities(author)}</span>}
          {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground py-1">
            원본보기<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only"> (새 탭에서 열기)</span>
          </a>}
          {onSendEmail && <button type="button" onClick={() => onSendEmail(id)} aria-label={`${text.title} 이메일로 발송`} className="inline-flex shrink-0 items-center gap-1 hover:text-foreground py-1">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />이메일
          </button>}
        </div>
      </div>
    </article>
  )
}
