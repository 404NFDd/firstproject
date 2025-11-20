"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { NewsCard } from "@/components/news-card"
import { Loader2 } from "lucide-react"

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const fetchBookmarks = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/news/bookmarks?page=${page}&limit=12`)
        const data = await response.json()
        setBookmarks(data.bookmarks || [])
      } catch (error) {
        console.error("Error fetching bookmarks:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchBookmarks()
  }, [page])

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">즐겨찾기</h1>
          <p className="text-muted-foreground">저장한 {bookmarks.length}개의 뉴스</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">저장한 뉴스가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-12">
              {bookmarks.map((article: any) => (
                <NewsCard
                  key={article.id}
                  id={article.id}
                  title={article.title}
                  description={article.description || ""}
                  imageUrl={article.imageUrl}
                  source={article.source}
                  publishedAt={article.publishedAt}
                  isBookmarked={true}
                />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50 transition"
              >
                이전
              </button>
              <span className="text-sm text-muted-foreground px-4 py-2">페이지 {page}</span>
              <button
                onClick={() => setPage(page + 1)}
                className="px-4 py-2 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground transition"
              >
                다음
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
