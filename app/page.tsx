"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Header } from "@/components/header"
import { NewsCard } from "@/components/news-card"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function Dashboard() {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState("general")
  const [selectedNews, setSelectedNews] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  const observerTarget = useRef<HTMLDivElement>(null)
  const isLoadingMore = useRef(false)

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory)
    setNews([])
    setPage(1)
    setHasMore(true)
  }

  const fetchNews = useCallback(
    async (pageNum: number, append = false) => {
      if (isLoadingMore.current) return

      isLoadingMore.current = true
      if (!append) setLoading(true)

      try {
        const response = await fetch(`/api/news?page=${pageNum}&limit=12&category=${category}`)
        const data = await response.json()

        const newArticles = data.news || []

        if (append) {
          setNews((prevNews) => [...prevNews, ...newArticles])
        } else {
          setNews(newArticles)
        }

        setHasMore(newArticles.length === 12)
        setPage(pageNum)
      } catch (error) {
        console.error("[v0] Error fetching news:", error)
        toast({
          title: "오류",
          description: "뉴스를 불러올 수 없습니다.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
        isLoadingMore.current = false
      }
    },
    [category, toast],
  )

  useEffect(() => {
    fetchNews(1, false)
  }, [category, fetchNews])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore.current) {
          fetchNews(page + 1, true)
        }
      },
      { threshold: 0.1 },
    )

    const target = observerTarget.current
    if (target) {
      observer.observe(target)
    }

    return () => {
      if (target) {
        observer.unobserve(target)
      }
    }
  }, [page, hasMore, fetchNews])

  const handleSendEmail = async (newsId: string) => {
    try {
      const response = await fetch("/api/news/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsIds: [newsId],
          title: "NewsHub - 기사 공유",
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "이메일 발송 실패")
      }

      toast({
        title: "성공",
        description: "이메일이 성공적으로 발송되었습니다.",
      })
    } catch (error) {
      console.error("[v0] Error sending email:", error)
      toast({
        title: "오류",
        description: error instanceof Error ? error.message : "이메일 발송에 실패했습니다.",
        variant: "destructive",
      })
    }
  }

  const handleSendSelectedEmail = async () => {
    if (selectedNews.size === 0) {
      toast({
        title: "알림",
        description: "이메일로 발송할 기사를 선택해주세요.",
      })
      return
    }

    try {
      const response = await fetch("/api/news/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsIds: Array.from(selectedNews),
          title: `NewsHub - ${selectedNews.size}개 기사`,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "이메일 발송 실패")
      }

      toast({
        title: "성공",
        description: `${selectedNews.size}개 기사가 이메일로 발송되었습니다.`,
      })
      setSelectedNews(new Set())
    } catch (error) {
      console.error("[v0] Error sending emails:", error)
      toast({
        title: "오류",
        description: error instanceof Error ? error.message : "이메일 발송에 실패했습니다.",
        variant: "destructive",
      })
    }
  }

  const categories = [
    { value: "general", label: "전체" },
    { value: "business", label: "비즈니스" },
    { value: "technology", label: "기술" },
    { value: "entertainment", label: "엔터테인먼트" },
    { value: "health", label: "건강" },
    { value: "sports", label: "스포츠" },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-2">최신 뉴스를 한 곳에서</h1>
            <p className="text-base sm:text-lg text-muted-foreground">세계의 주요 뉴스를 실시간으로 받아보세요</p>
          </div>

          {/* Category Filter */}
          <div className="flex overflow-x-auto gap-2 pb-4 mb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${category === cat.value
                    ? "bg-primary text-primary-foreground"
                    : "glass text-muted-foreground hover:text-foreground"
                  }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
            <div className="text-sm text-muted-foreground">
              <a
                href="/api/rss"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-accent hover:text-primary transition"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.3A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13H5.5z" />
                </svg>
                RSS 피드 구독
              </a>
            </div>

            {selectedNews.size > 0 && (
              <button
                onClick={handleSendSelectedEmail}
                className="px-4 py-2 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 transition text-sm font-medium"
              >
                {selectedNews.size}개 기사 이메일 발송
              </button>
            )}
          </div>

          {/* News Grid */}
          {loading && news.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {news.map((article: any) => (
                  <div
                    key={article.id}
                    className="relative"
                    onClick={() => {
                      const newSelected = new Set(selectedNews)
                      if (newSelected.has(article.id)) {
                        newSelected.delete(article.id)
                      } else {
                        newSelected.add(article.id)
                      }
                      setSelectedNews(newSelected)
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNews.has(article.id)}
                      onChange={() => { }}
                      className="absolute top-3 left-3 w-5 h-5 z-10 cursor-pointer"
                    />
                    <NewsCard
                      id={article.id}
                      title={article.title}
                      description={article.description || ""}
                      imageUrl={article.imageUrl}
                      source={article.source}
                      publishedAt={article.publishedAt}
                      onSendEmail={handleSendEmail}
                    />
                  </div>
                ))}
              </div>

              {hasMore && (
                <div ref={observerTarget} className="py-12 flex justify-center">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              )}

              {!hasMore && news.length > 0 && (
                <div className="py-8 text-center text-muted-foreground">모든 뉴스를 로드했습니다.</div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
