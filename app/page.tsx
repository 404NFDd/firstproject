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
  const [syncing, setSyncing] = useState(false)
  const [hasCheckedSync, setHasCheckedSync] = useState(false)
  const [syncAttempted, setSyncAttempted] = useState(false)
  const { toast } = useToast()

  const observerTarget = useRef<HTMLDivElement>(null)
  const isLoadingMore = useRef(false)

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory)
    setNews([])
    setPage(1)
    setHasMore(true)
    setSyncAttempted(false)
    setHasCheckedSync(false)
  }

  const fetchNews = useCallback(
    async (pageNum: number, append = false, categoryOverride?: string) => {
      if (isLoadingMore.current) return

      isLoadingMore.current = true
      if (!append) setLoading(true)

      try {
        // "general" 카테고리는 API에서 undefined로 전달 (모든 카테고리 조회)
        const currentCategory = categoryOverride ?? category
        const categoryParam = currentCategory === "general" ? undefined : currentCategory
        const response = await fetch(
          `/api/news?page=${pageNum}&limit=12${categoryParam ? `&category=${categoryParam}` : ""}`
        )
        const data = await response.json()

        const newArticles = data.news || []

        if (append) {
          setNews((prevNews) => [...prevNews, ...newArticles])
        } else {
          setNews(newArticles)
        }

        // 더 가져올 뉴스가 있는지 확인 (pagination 정보 사용)
        const totalPages = data.pagination?.pages || 0
        const currentPage = data.pagination?.page || pageNum
        setHasMore(currentPage < totalPages && newArticles.length > 0)
        setPage(pageNum)

        // 뉴스가 없고 아직 동기화를 시도하지 않았다면 자동으로 수집 시도
        if (!hasCheckedSync && newArticles.length === 0 && !append) {
          setHasCheckedSync(true)
        }
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
    [category, toast, hasCheckedSync],
  )

  const syncNews = useCallback(async () => {
    if (syncing) return

    setSyncing(true)
    setSyncAttempted(true)
    try {
      const response = await fetch("/api/news/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "뉴스 수집 실패")
      }

      toast({
        title: "성공",
        description: `뉴스 ${data.persisted}개를 수집했습니다.`,
      })

      // 수집 후 뉴스 다시 불러오기
      await fetchNews(1, false)
    } catch (error) {
      console.error("[v0] Error syncing news:", error)
      toast({
        title: "오류",
        description: error instanceof Error ? error.message : "뉴스 수집에 실패했습니다.",
        variant: "destructive",
      })
    } finally {
      setSyncing(false)
    }
  }, [syncing, toast, fetchNews])

  // 뉴스가 없을 때 자동 수집 시도 (한 번만)
  useEffect(() => {
    if (hasCheckedSync && news.length === 0 && !loading && !syncing && !syncAttempted) {
      const timer = setTimeout(() => {
        syncNews()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [hasCheckedSync, news.length, loading, syncing, syncAttempted, syncNews])

  useEffect(() => {
    // 카테고리 변경 시 첫 페이지부터 다시 로드
    setNews([])
    setPage(1)
    setHasMore(true)
    fetchNews(1, false, category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  useEffect(() => {
    // 로딩 중이거나 더 이상 가져올 뉴스가 없으면 관찰하지 않음
    if (loading || !hasMore || news.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore.current && !loading) {
          const nextPage = page + 1
          fetchNews(nextPage, true, category)
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, hasMore, loading, news.length, category])

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
    { value: "developer", label: "개발자" },
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
            <div className="flex items-center gap-4 flex-wrap">
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
              <button
                onClick={syncNews}
                disabled={syncing}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {syncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    수집 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    뉴스 수집
                  </>
                )}
              </button>
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
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground">
                {syncing ? "뉴스를 수집하고 있습니다..." : "뉴스를 불러오는 중..."}
              </p>
            </div>
          ) : news.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg
                className="w-16 h-16 text-muted-foreground mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                />
              </svg>
              <h3 className="text-xl font-semibold text-foreground mb-2">뉴스가 없습니다</h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                뉴스를 수집하려면 위의 "뉴스 수집" 버튼을 클릭하세요.
                <br />
                NewsAPI와 RSS 피드에서 최신 뉴스를 가져옵니다.
              </p>
              <button
                onClick={syncNews}
                disabled={syncing}
                className="px-6 py-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {syncing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    수집 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    뉴스 수집 시작
                  </>
                )}
              </button>
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
