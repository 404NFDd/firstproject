"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { ArrowLeft, Share2, ExternalLink, Loader2 } from "lucide-react"
import Image from "next/image"
import { decodeHtmlEntities } from "@/lib/text"
import { NewsSummary } from "@/components/news-summary"
import { TECH_NEWS_CATEGORY_VALUES, getNewsCategoryLabel } from "@/lib/news-categories"
import { getSafeNewsUrl } from "@/lib/news-links"
import { useToast } from "@/hooks/use-toast"
import type { CurationResult } from "@/lib/news-curation"

interface NewsDetail {
  id: string
  title: string
  description: string | null
  content: string | null
  imageUrl?: string
  sourceUrl: string | null
  source: string
  category?: string | null
  author?: string
  publishedAt: string
  summary?: CurationResult | null
}

// 뉴스 상세 페이지 컴포넌트
// Input: URL 파라미터(`params.id`)를 통해 뉴스 ID를 받음
// Output: 로딩/에러/정상 상태에 따라 다른 JSX를 반환
export default function NewsDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [news, setNews] = useState<NewsDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const { toast } = useToast()

  // 페이지 로드 시 스크롤을 최상단으로 강제 이동
  useEffect(() => {
    // 즉시 스크롤을 최상단으로 이동
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0

    // 약간의 지연 후 다시 확인 (이미지 로딩/레이아웃 시프트로 인한
    // 의도치 않은 스크롤 이동을 재보정하기 위함)
    const timer1 = setTimeout(() => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }, 0)

    const timer2 = setTimeout(() => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }, 100)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
    }
  }, [params.id])

  useEffect(() => {
    const controller = new AbortController()
    setNews(null)
    setError(null)
    setLoading(true)

    const fetchNews = async () => {
      try {
        const response = await fetch(`/api/news/${encodeURIComponent(String(params.id))}`, {
          signal: controller.signal,
        })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) {
          throw new Error(response.status === 404 ? "뉴스를 찾을 수 없습니다." : data.error || "뉴스를 불러오지 못했습니다.")
        }
        setNews(data)
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("뉴스 상세 조회 실패:", error)
        setError(error instanceof Error ? error.message : "뉴스를 불러오지 못했습니다.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    if (params.id) void fetchNews()
    else setLoading(false)
    return () => {
      controller.abort()
    }
  }, [params.id])

  const summary = news?.summary
  const decodedTitle = decodeHtmlEntities(summary?.title || news?.title).trim()
  const sourceLabel = decodeHtmlEntities(news?.source).trim() || "출처 미확인"
  const authorLabel = decodeHtmlEntities(news?.author).trim()
  const sourceUrl = getSafeNewsUrl(news?.sourceUrl)
  const isTechFeed = TECH_NEWS_CATEGORY_VALUES.some((value) => value === news?.category)
  const handleShare = async () => {
    if (!news || sharing) return
    setSharing(true)
    try {
      const url = window.location.href
      if (typeof navigator.share === "function") {
        await navigator.share({ title: decodedTitle, url })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        toast({ title: "링크를 복사했습니다", description: "원하는 곳에 붙여넣어 기사를 공유하세요." })
      } else {
        throw new Error("주소창의 링크를 복사해 기사를 공유해주세요.")
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      toast({
        title: "공유하지 못했습니다",
        description: "주소창의 링크를 복사해 기사를 공유해주세요.",
        variant: "destructive",
      })
    } finally {
      setSharing(false)
    }
  }
  // 뒤로가기/목록 복귀 처리
  // Input: 없음(클릭 이벤트로 호출)
  // Output: 현재 창 닫기 시도 후 실패하면 "/" 경로로 이동
  const handleBack = () => {
    // 브라우저 정책상 window.close()가 항상 허용되진 않는다.
    // 먼저 닫기를 시도하고, 닫히지 않으면 목록으로 fallback 한다.
    try {
      window.close()
    } catch {
      // ignore
    }

    setTimeout(() => {
      if (!window.closed) {
        router.push("/")
      }
    }, 50) // 닫기 시도 후 50ms 지연
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (!news) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <p className="text-muted-foreground" role="alert">{error || "뉴스를 찾을 수 없습니다."}</p>
          <button type="button" onClick={handleBack} className="mt-4 text-primary hover:underline">뉴스 목록으로</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Back Button */}
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          뉴스 목록으로
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-primary/20 text-primary">
                {getNewsCategoryLabel(news.category)}
              </span>
              <span className="inline-flex px-3 py-1 rounded-full text-sm text-muted-foreground bg-muted">
                출처: {sourceLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleShare} disabled={sharing} aria-label="기사 공유" className="p-2 rounded-lg border border-border bg-card hover:bg-input transition disabled:opacity-50">
                <Share2 className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">{sourceUrl ?
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{decodedTitle}</a> : decodedTitle}</h1>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {authorLabel && <p>작성: {authorLabel}</p>}
            <p>
              {isTechFeed ? "게시·갱신:" : "발행:"} <time dateTime={news.publishedAt} title={isTechFeed ? "피드가 제공한 게시 또는 갱신 시각, 한국 시간" : "한국 시간 기준"}>{new Date(news.publishedAt).toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}</time> (한국 시간)
            </p>
          </div>
        </div>

        {summary && <p className="mb-6 text-xs text-muted-foreground">AI가 원문을 한국어로 요약·정리했습니다.</p>}

        {/* Image */}
        {news.imageUrl && (
          <div className="relative w-full h-96 rounded-lg overflow-hidden mb-8 bg-muted">
            <Image
              src={news.imageUrl || "/placeholder.svg"}
              alt={decodedTitle}
              fill
              className="object-scale-down"
              sizes="(max-width: 768px) 100vw, 768px"
              priority
            />
          </div>
        )}

        {/* 한국어 핵심 요약과 주제별 상세 정리 */}
        <div className="max-w-none mb-8">
          {summary ? <NewsSummary summary={summary} /> : (
            <p className="p-4 rounded-lg border border-border bg-muted text-muted-foreground">
              한국어 요약·정리가 아직 준비되지 않았습니다.
            </p>
          )}
        </div>

        {/* 기사 원문 */}
        <div className="p-4 rounded-lg border border-border bg-card">
          {sourceUrl ? (
            <>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-2"
              >
                원본보기
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
              </a>
              <p className="text-sm text-muted-foreground mt-2">원문은 출처 사이트에서 확인할 수 있습니다.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">출처 링크를 확인할 수 없습니다.</p>
          )}
        </div>
      </main>

      <button
        type="button"
        aria-label="뉴스 목록으로"
        onClick={handleBack}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition active:scale-95 hover:bg-primary/90"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>
    </div>
  )
}
