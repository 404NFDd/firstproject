"use client"

import { Suspense, useState, useEffect, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Header } from "@/components/header"
import { NewsCard } from "@/components/news-card"
import { NEWS_CATEGORIES, TECH_NEWS_CATEGORY_VALUES, getNewsCategoryLabel } from "@/lib/news-categories"
import { TECH_FEED_SOURCES } from "@/lib/feed-sources"
import { readNewsListFilters, newsListQuery } from "@/lib/news-list-filters"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface NewsArticle {
  id: string
  title: string
  description?: string
  preview?: string
  previewType?: "summary" | "description" | "content" | "none"
  originalTitle?: string
  isTranslated?: boolean
  imageUrl?: string
  sourceUrl?: string
  source: string
  author?: string
  publishedAt: string
  category?: string
  priority?: number
}

function getSyncScope(category: string): "tech" | "all" {
  return category === "tech" || category === "105" || TECH_NEWS_CATEGORY_VALUES.some((value) => value === category) ? "tech" : "all"
}

function Dashboard() {
  const router = useRouter()
  const { status: sessionStatus } = useSession()
  const [news, setNews] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const searchParams = useSearchParams()
  const filters = readNewsListFilters(searchParams)
  const { category, search, sort } = filters
  const filterKey = newsListQuery(filters)
  const [searchDraft, setSearchDraft] = useState(search)
  const [selectedNews, setSelectedNews] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [hasCheckedSync, setHasCheckedSync] = useState(false)
  const [syncAttempted, setSyncAttempted] = useState(false)
  const [loadError, setLoadError] = useState<{ message: string; page: number; append: boolean } | null>(null)
  const { toast } = useToast()

  const observerTarget = useRef<HTMLDivElement>(null)
  const activeCategory = useRef(category)
  const activeQuery = useRef(filterKey)
  const listRequest = useRef<AbortController | null>(null)
  const syncRequest = useRef<AbortController | null>(null)

  const changeFilters = (patch: Partial<typeof filters>) => {
    const next = { ...readNewsListFilters(new URLSearchParams(activeQuery.current)), ...patch }
    const query = newsListQuery(next)
    if (query === activeQuery.current) return
    activeQuery.current = query
    activeCategory.current = next.category
    listRequest.current?.abort()
    router.push("/?" + query, { scroll: false })
  }
  const handleCategoryChange = (newCategory: string) => changeFilters({ category: readNewsListFilters(new URLSearchParams({ category: newCategory })).category })

  // 교체 요청은 이전 조회를 취소하고, 추가 조회는 동시에 하나만 실행한다.
  const fetchNews = useCallback(
    async (pageNum: number, append = false, queryOverride?: string) => {
      const currentQuery = queryOverride ?? activeQuery.current
      if (currentQuery !== activeQuery.current || (append && listRequest.current)) return
      listRequest.current?.abort()
      const controller = new AbortController()
      listRequest.current = controller
      setLoading(true)
      setLoadError(null)
      if (!append) setHasCheckedSync(false)

      try {
        const params = new URLSearchParams(currentQuery)
        params.set("page", String(pageNum))
        params.set("limit", "12")
        const response = await fetch("/api/news?" + params.toString(), {
          signal: controller.signal,
        })
        const data = await response.json()
        if (controller.signal.aborted || activeQuery.current !== currentQuery) return
        if (!response.ok) {
          throw new Error(data.error || "뉴스를 불러올 수 없습니다.")
        }

        const newArticles: NewsArticle[] = Array.isArray(data.news) ? data.news : []
        setNews((previous) => {
          const articles = append ? [...previous, ...newArticles] : newArticles
          return Array.from(new Map(articles.map((article) => [article.id, article])).values())
        })
        if (!append) {
          const visibleIds = new Set(newArticles.map((article) => article.id))
          setSelectedNews((previous) => new Set([...previous].filter((id) => visibleIds.has(id))))
          setHasCheckedSync(true)
        }
        const totalPages = data.pagination?.pages || 0
        setHasMore(pageNum < totalPages && newArticles.length > 0)
        setPage(pageNum)
      } catch (error) {
        if (controller.signal.aborted || activeQuery.current !== currentQuery) return
        const message = error instanceof Error ? error.message : "뉴스를 불러올 수 없습니다."
        console.error("뉴스 조회 실패:", error)
        setLoadError({ message, page: pageNum, append })
        toast({ title: "오류", description: message, variant: "destructive" })
      } finally {
        if (listRequest.current === controller) {
          listRequest.current = null
          if (!controller.signal.aborted) setLoading(false)
        }
      }
    },
    [toast],
  )

  const syncNews = useCallback(async () => {
    if (syncRequest.current || sessionStatus === "loading") return
    if (sessionStatus !== "authenticated") {
      toast({ title: "로그인이 필요합니다", description: "로그인 후 뉴스를 수집할 수 있습니다." })
      router.push("/auth/login")
      return
    }

    const controller = new AbortController()
    syncRequest.current = controller
    setSyncing(true)
    setSyncAttempted(true)
    try {
      const response = await fetch("/api/news/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ scope: getSyncScope(activeCategory.current),
          ...(activeCategory.current === "tech" || activeCategory.current === "all" ? {} : { categories: [activeCategory.current] }) }),
      })
      const data = await response.json()
      if (controller.signal.aborted) return

      if (response.status === 401) {
        toast({ title: "다시 로그인해주세요", description: "로그인이 만료되었습니다." })
        router.push("/auth/login")
        return
      }
      if (response.status === 429) {
        toast({
          title: "알림",
          description: data.message || "최근 1시간 이내에 이미 뉴스를 수집했습니다. 피드만 새로고침합니다.",
        })
      } else if (!response.ok) {
        throw new Error(data.error || "뉴스 수집 실패")
      } else {
        const failedCategories: string[] = Array.isArray(data.failedCategories) ? data.failedCategories : []
        const failedSources: string[] = Array.isArray(data.failedSources) ? data.failedSources : []
        const failures = [
          failedCategories.length ? `카테고리: ${failedCategories.map(getNewsCategoryLabel).join(", ")}` : "",
          failedSources.length ? `출처: ${failedSources.map((id) => TECH_FEED_SOURCES.find((source) => source.id === id)?.name || "기타 출처").join(", ")}` : "",
        ].filter(Boolean)
        toast({
          title: failures.length || data.excludedCount ? "일부 수집 완료" : "성공",
          description: `후보 ${data.createdCount}건 / 본문 보강 ${data.repairedCount}건 / 중복 ${data.skipped}건 / 제외 ${data.excludedCount}건${failures.length ? ` / 수집하지 못한 ${failures.join("; ")}` : ""}. 기술 소식은 선별과 AI 요약 후 표시됩니다.`,
        })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      console.error("뉴스 수집 실패:", error)
      toast({
        title: "오류",
        description: error instanceof Error ? error.message : "뉴스 수집에 실패했습니다.",
        variant: "destructive",
      })
    } finally {
      if (!controller.signal.aborted) {
        await fetchNews(1)
        if (!controller.signal.aborted) setSyncing(false)
      }
      if (syncRequest.current === controller) syncRequest.current = null
    }
  }, [sessionStatus, router, toast, fetchNews])

  // 자동 수집은 로그인한 상태에서 목록 조회에 성공한 뒤 한 번만 시도한다.
  useEffect(() => {
    if (!search && sessionStatus === "authenticated" && hasCheckedSync && news.length === 0 && !loading && !syncing && !syncAttempted) {
      const timer = setTimeout(() => { void syncNews() }, 1000)
      return () => clearTimeout(timer)
    }
  }, [search, sessionStatus, hasCheckedSync, news.length, loading, syncing, syncAttempted, syncNews])

  useEffect(() => {
    activeCategory.current = category
    activeQuery.current = filterKey
    setSearchDraft(search)
    setNews([])
    setSelectedNews(new Set())
    setPage(1)
    setHasMore(true)
    setLoadError(null)
    setHasCheckedSync(false)
    void fetchNews(1, false, filterKey)
    return () => listRequest.current?.abort()
  }, [category, search, filterKey, fetchNews])

  useEffect(() => () => syncRequest.current?.abort(), [])

  useEffect(() => {
    if (loading || loadError || !hasMore || news.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !listRequest.current) {
          void fetchNews(page + 1, true, filterKey)
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    )
    const target = observerTarget.current
    if (target) observer.observe(target)
    return () => observer.disconnect()
  }, [page, hasMore, loading, loadError, news.length, filterKey, fetchNews])

  // 단일 기사 이메일 발송
  // Input: newsId(발송할 기사 ID)
  // Output: 성공/실패 토스트 노출
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

  // 선택된 여러 기사 이메일 발송
  // Input: selectedNews(Set<string>)
  // Output: 발송 성공 시 선택 상태 초기화
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
    { value: "tech", label: "기술 전체", description: "개발, 엔지니어링, AI, 클라우드와 릴리스 소식을 여러 기술 피드와 네이버 IT·과학 뉴스에서 모아봅니다." },
    ...NEWS_CATEGORIES.map((item) => item.value === "105" ? { ...item, label: "네이버 IT·과학" } : item),
    { value: "all", label: "모든 뉴스", description: "개발·기술 소식과 종합뉴스를 발행 시각 순으로 살펴봅니다." },
  ]
  const categoryDescription = categories.find((item) => item.value === category)?.description
  const categoryName = category === "tech" ? "개발·기술 전체" : category === "all" ? "전체" : getNewsCategoryLabel(category)
  const syncLabel = "뉴스 수집"

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">뉴스 피드</h1>
            <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
              기술 뉴스를 모아 AI로 요약합니다.
            </p>
            <Link href="/guide" className="inline-flex mt-2 text-xs text-primary hover:underline">
              수집과 AI 요약 안내
            </Link>
          </div>

          {/* Category Filter */}
          <div className="flex overflow-x-auto md:flex-wrap md:overflow-visible gap-2 pb-3 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
            {categories.map((cat) => (
              <button
                key={cat.value}
                aria-pressed={category === cat.value}
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

          <form onSubmit={(event) => { event.preventDefault(); changeFilters({ search: searchDraft.trim() }) }} className="mb-6 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48">
              <label htmlFor="news-search" className="block text-sm mb-2">뉴스 검색</label>
              <input id="news-search" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
                maxLength={200} placeholder="제목과 본문에서 검색"
                className="w-full rounded-md border border-border bg-card px-3 py-2" />
            </div>
            <button type="submit" className="rounded-md bg-primary text-primary-foreground px-4 py-2">검색</button>
            {search && <button type="button" onClick={() => changeFilters({ search: "" })} className="rounded-md border border-border px-4 py-2">검색 해제</button>}
            <div>
              <label htmlFor="news-sort" className="block text-sm mb-2">정렬</label>
              <select id="news-sort" value={sort} onChange={(event) => changeFilters({ sort: event.target.value as typeof sort })}
                className="rounded-md border border-border bg-card px-3 py-2">
                <option value="latest">최신순</option><option value="priority">우선순위순</option><option value="popular">인기순</option>
              </select>
            </div>
          </form>

          <div className="mb-5" aria-live="polite">
            <h2 className="text-xl font-semibold">{categoryName} 소식</h2>
            <p className="mt-1 text-sm text-muted-foreground">{categoryDescription}</p>
          </div>

          <div className="mb-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={syncNews}
                disabled={syncing || sessionStatus === "loading"}
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
                    {sessionStatus === "unauthenticated" ? `로그인하고 ${syncLabel}` : syncLabel}
                  </>
                )}
              </button>
              <p className="text-xs text-muted-foreground">뉴스 피드를 수집합니다.</p>
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
          ) : loadError && news.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center" role="alert">
              <h3 className="text-xl font-semibold text-foreground mb-2">뉴스를 불러오지 못했습니다</h3>
              <p className="text-muted-foreground mb-6">{loadError.message}</p>
              <button
                type="button"
                onClick={() => { void fetchNews(1) }}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                다시 불러오기
              </button>
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
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {search ? "검색 조건에 맞는 소식이 없습니다" : `아직 저장된 ${categoryName} 소식이 없습니다`}
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                {search ? "검색어를 바꾸거나 검색을 해제해 주세요." : sessionStatus === "authenticated"
                  ? `${syncLabel}으로 후보를 확인할 수 있습니다. 기술 소식은 선별과 AI 요약이 끝나면 표시됩니다. 수집 후에는 1시간 동안 추가 수집이 제한됩니다.`
                  : "저장된 글은 로그인 없이 읽을 수 있습니다. 새 소식을 수집하려면 로그인해 주세요."}
              </p>
              {category !== "all" && (
                <button type="button" onClick={() => handleCategoryChange("all")} className="mb-4 text-primary hover:underline">
                  모든 뉴스 살펴보기
                </button>
              )}
              <button
                onClick={syncNews}
                disabled={syncing || sessionStatus === "loading"}
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
                    {sessionStatus === "unauthenticated" ? `로그인하고 ${syncLabel}` : syncLabel}
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border border-y border-border">
                {news.map((article) => (
                  <div key={article.id} className="relative">
                    <input
                      type="checkbox"
                      aria-label={`${article.title} 이메일 발송 대상 선택`}
                      checked={selectedNews.has(article.id)}
                      onChange={(event) => {
                        const checked = event.target.checked
                        if (checked && selectedNews.size >= 50) {
                          toast({ title: "선택 제한", description: "이메일은 한 번에 최대 50개 기사까지 발송할 수 있습니다." })
                          return
                        }
                        setSelectedNews((previous) => {
                          const next = new Set(previous)
                          if (checked) next.add(article.id)
                          else next.delete(article.id)
                          return next
                        })
                      }}
                      className="absolute top-6 left-0 w-4 h-4 z-10 cursor-pointer accent-primary"
                    />
                    <NewsCard
                      id={article.id}
                      title={article.title}
                      originalTitle={article.originalTitle}
                      isTranslated={article.isTranslated}
                      description={article.description || ""}
                      sourceUrl={article.sourceUrl}
                      imageUrl={article.imageUrl}
                      source={article.source}
                      category={article.category}
                      author={article.author}
                      preview={article.preview}
                      previewType={article.previewType}
                      publishedAt={article.publishedAt}
                      onSendEmail={handleSendEmail}
                    />
                  </div>
                ))}
              </div>

              {(hasMore || loadError) && (
                <div ref={observerTarget} className="py-12 flex justify-center">
                  {loadError ? (
                    <button
                      type="button"
                      onClick={() => { if (loadError) void fetchNews(loadError.page, loadError.append) }}
                      className="px-4 py-2 rounded-md border border-border hover:bg-muted"
                    >
                      {loadError.append ? "뉴스 더 불러오기 재시도" : "뉴스 새로고침 재시도"}
                    </button>
                  ) : (
                    <Loader2 className="w-8 h-8 text-primary animate-spin" aria-label="뉴스를 더 불러오는 중" />
                  )}
                </div>
              )}

              {!hasMore && !loadError && news.length > 0 && (
                <div className="py-8 text-center text-muted-foreground">이 카테고리의 저장된 기사를 모두 확인했습니다.</div>
              )}
            </>
          )}
        </section>
      </main>
      <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-6 border-t border-border text-sm text-muted-foreground">
        <p>기술 소식은 원문을 확인하고 선별해 AI로 요약합니다. 전체 맥락은 연결된 출처에서 확인하세요.</p>
        <Link href="/guide" className="inline-block mt-2 text-primary hover:underline">수집 방식과 브리핑 안내</Link>
      </footer>
    </div>
  )
}


export default function NewsPage() {
  return <Suspense fallback={<div className="p-8 text-center" role="status">뉴스를 불러오는 중입니다…</div>}><Dashboard /></Suspense>
}
