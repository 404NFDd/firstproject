"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"

interface NewsCardProps {
  id: string
  title: string
  description: string
  imageUrl?: string
  source: string
  publishedAt: string
  isBookmarked?: boolean
  onBookmark?: (newsId: string) => void
  onSendEmail?: (newsId: string) => void
}

export function NewsCard({
  id,
  title,
  description,
  imageUrl,
  source,
  publishedAt,
  isBookmarked = false,
  onBookmark,
  onSendEmail,
}: NewsCardProps) {
  const [bookmarked, setBookmarked] = useState(isBookmarked)

  const handleBookmark = async (e: React.MouseEvent) => {
    e.preventDefault()
    setBookmarked(!bookmarked)
    onBookmark?.(id)
  }

  const handleSendEmail = async (e: React.MouseEvent) => {
    e.preventDefault()
    onSendEmail?.(id)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // HTML 엔티티 디코딩
  const decodeHtmlEntities = (text: string | null | undefined): string => {
    if (!text || typeof text !== "string") return ""
    if (typeof window === "undefined") return text
    const textarea = document.createElement("textarea")
    textarea.innerHTML = text
    return textarea.value || ""
  }

  const decodedTitle = decodeHtmlEntities(title)
  const decodedDescription = decodeHtmlEntities(description)

  return (
    <Link href={`/news/${id}`}>
      <article className="group h-full flex flex-col rounded-lg glass-effect overflow-hidden hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/20">
        {/* Image */}
        <div className="relative w-full h-40 sm:h-48 overflow-hidden bg-muted">
          {imageUrl ? (
            <Image
              src={imageUrl || "/placeholder.svg"}
              alt={decodedTitle}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-lg bg-primary/20 mx-auto mb-2"></div>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-primary/20 text-primary">
              {source}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleSendEmail}
                className="text-muted-foreground hover:text-accent transition flex-shrink-0"
                title="이메일로 발송"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </button>
              <button
                onClick={handleBookmark}
                className="text-muted-foreground hover:text-primary transition flex-shrink-0"
              >
                {bookmarked ? (
                  <svg
                    className="w-5 h-5 text-primary"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 5a2 2 0 012-2h6a2 2 0 012 2v16l-7-3.5L5 21V5z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <h3 className="text-sm sm:text-base font-bold text-foreground line-clamp-3 mb-2 group-hover:text-primary transition">
            {decodedTitle}
          </h3>

          {decodedDescription && (
            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">{decodedDescription}</p>
          )}

          <div className="flex items-center justify-between">
            <time className="text-xs text-muted-foreground">{formatDate(publishedAt)}</time>
            <svg
              className="w-4 h-4 text-muted-foreground group-hover:text-primary transition opacity-0 group-hover:opacity-100"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        </div>
      </article>
    </Link>
  )
}
