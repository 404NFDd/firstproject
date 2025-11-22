"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Header } from "@/components/header"
import { ArrowLeft, Bookmark, BookmarkCheck, Share2, Loader2 } from "lucide-react"
import Link from "next/link"
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
  bookmarks: any[]
}

export default function NewsDetailPage() {
  const params = useParams()
  const [news, setNews] = useState<NewsDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookmarked, setBookmarked] = useState(false)

  // 페이지 로드 시 스크롤을 최상단으로 강제 이동
  useEffect(() => {
    // 즉시 스크롤을 최상단으로 이동
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0

    // 약간의 지연 후 다시 확인 (레이아웃 시프트 대응)
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
    const fetchNews = async () => {
      try {
        const response = await fetch(`/api/news/${params.id}`)
        if (response.ok) {
          const data = await response.json()
          setNews(data)
          setBookmarked(data.bookmarks?.length > 0)
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

  const handleBookmark = async () => {
    try {
      if (bookmarked) {
        await fetch(`/api/news/bookmark?newsId=${news?.id}`, { method: "DELETE" })
      } else {
        await fetch("/api/news/bookmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newsId: news?.id }),
        })
      }
      setBookmarked(!bookmarked)
    } catch (error) {
      console.error("Error bookmarking:", error)
    }
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
        <Link href="/" className="inline-flex items-center gap-2 text-primary hover:underline mb-6">
          <ArrowLeft className="w-4 h-4" />
          뉴스 목록으로
        </Link>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-primary/20 text-primary">
              {news.source}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBookmark}
                className="p-2 rounded-lg border border-border bg-card hover:bg-input transition"
              >
                {bookmarked ? (
                  <BookmarkCheck className="w-5 h-5 text-primary" />
                ) : (
                  <Bookmark className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
              <button className="p-2 rounded-lg border border-border bg-card hover:bg-input transition">
                <Share2 className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">{news.title}</h1>

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
              alt={news.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
              priority
            />
          </div>
        )}

        {/* Content */}
        <div className="prose prose-invert max-w-none mb-8">
          {news.description && <p className="text-lg text-muted-foreground mb-6 leading-relaxed">{news.description}</p>}

          {news.content && <div className="text-foreground leading-relaxed whitespace-pre-wrap">{news.content}</div>}
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
    </div>
  )
}
