"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { ArrowLeft, Share2, Loader2 } from "lucide-react"
import Image from "next/image"

interface NewsDetail {
  id: string
  title: string
  description: string
  content: string
  imageUrl?: string
  sourceUrl: string
  source: string
  author?: string
  publishedAt: string
}

// 뉴스 상세 페이지 컴포넌트
// Input: URL 파라미터(`params.id`)를 통해 뉴스 ID를 받음
// Output: 로딩/에러/정상 상태에 따라 다른 JSX를 반환
export default function NewsDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [news, setNews] = useState<NewsDetail | null>(null)
  const [loading, setLoading] = useState(true)

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
    // Input: params.id (현재 뉴스 ID)
    // Output: 성공 시 `news` 상태를 채우고, 완료 시 `loading=false`로 전환
    const fetchNews = async () => {
      try {
        const response = await fetch(`/api/news/${params.id}`)
        if (response.ok) {
          const data = await response.json()
          setNews(data)
        }
      } catch (error) {
        console.error("Error fetching news:", error)
      } finally {
        setLoading(false)
        // 데이터 로드 후에도 스크롤 위치 확인
        window.scrollTo(0, 0)
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
      }
    }

    if (params.id) {
      fetchNews()
    }
  }, [params.id])


  // HTML 엔티티 디코딩
  // Input: 엔티티가 포함될 수 있는 문자열(또는 null/undefined)
  // Output: 디코딩된 일반 문자열. 비정상 입력이면 빈 문자열 반환
  const decodeHtmlEntities = (text: string | null | undefined): string => {
    if (!text || typeof text !== "string") return ""
    // SSR 환경에서는 DOM API(document)가 없으므로 원본 문자열을 그대로 사용
    if (typeof window === "undefined") return text
    const textarea = document.createElement("textarea")
    textarea.innerHTML = text
    return textarea.value || ""
  }

  const decodedTitle = news ? decodeHtmlEntities(news.title) : ""
  const decodedDescription = news ? decodeHtmlEntities(news.description) : ""
  const decodedContent = news ? decodeHtmlEntities(news.content) : ""

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
          <p className="text-muted-foreground">뉴스를 찾을 수 없습니다.</p>
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
            <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-primary/20 text-primary">
              {news.source}
            </span>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg border border-border bg-card hover:bg-input transition">
                <Share2 className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">{decodedTitle}</h1>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {news.author && <p>작성자: {news.author}</p>}
            <p>
              {new Date(news.publishedAt).toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>

        {/* Image */}
        {news.imageUrl && (
          <div className="relative w-full h-96 rounded-lg overflow-hidden mb-8 bg-muted">
            <Image
              src={news.imageUrl || "/placeholder.svg"}
              alt={decodedTitle}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
              priority
            />
          </div>
        )}

        {/* Content */}
        <div className="prose prose-invert max-w-none mb-8">
          {decodedDescription && <p className="text-lg text-muted-foreground mb-6 leading-relaxed">{decodedDescription}</p>}

          {decodedContent && <div className="text-foreground leading-relaxed whitespace-pre-wrap">{decodedContent}</div>}
        </div>

        {/* Source Link */}
        {news.sourceUrl && (
          <div className="p-4 rounded-lg border border-border bg-card">
            <a
              href={news.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-2"
            >
              원문 보기
              <Share2 className="w-4 h-4" />
            </a>
          </div>
        )}
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
