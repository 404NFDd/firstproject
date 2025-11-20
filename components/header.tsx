"use client"

import { useState } from "react"
import { Menu, X, Search, LogOut, Sun, Moon } from "lucide-react"
import Link from "next/link"
import { useTheme } from "@/components/theme-provider"

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="sticky top-0 z-50 w-full glass">
      <div className="flex h-16 max-w-7xl mx-auto px-4 sm:px-6 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-xl gradient-text">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-lg"></div>
          NewsHub
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
            대시보드
          </Link>
          <Link href="/bookmarks" className="text-sm text-muted-foreground hover:text-foreground transition">
            즐겨찾기
          </Link>
          <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground transition">
            프로필
          </Link>
          <a
            href="/api/rss"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:text-primary transition flex items-center gap-1"
            title="RSS 구독"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.3A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13H5.5z" />
            </svg>
            RSS
          </a>
        </nav>

        {/* Search and Theme - Desktop */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="relative hidden lg:block">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="뉴스 검색..."
              className="pl-9 pr-4 py-2 text-sm rounded-md glass text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-background/50 transition text-foreground"
            title={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={() => {}}
            className="text-sm text-muted-foreground hover:text-foreground transition flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">로그아웃</span>
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-background/50 transition text-foreground"
            title={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button onClick={() => setMenuOpen(!menuOpen)} className="text-foreground">
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="flex flex-col gap-4 p-4">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
              대시보드
            </Link>
            <Link href="/bookmarks" className="text-sm text-muted-foreground hover:text-foreground transition">
              즐겨찾기
            </Link>
            <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground transition">
              프로필
            </Link>
            <a
              href="/api/rss"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:text-primary transition flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.3A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13H5.5z" />
              </svg>
              RSS 구독
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}
