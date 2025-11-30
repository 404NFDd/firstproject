"use client"

import { useState, useEffect } from "react"
import { Menu, X, Search, LogOut, Sun, Moon, Mail } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { signOut, useSession } from "next-auth/react"
import { useTheme } from "@/components/theme-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [emailSubscribed, setEmailSubscribed] = useState(false)
  const [togglingEmail, setTogglingEmail] = useState(false)
  const [showSubscribeDialog, setShowSubscribeDialog] = useState(false)
  const { data: session, status } = useSession()
  const { theme, resolvedTheme, toggleTheme } = useTheme()

  useEffect(() => {
    let cancelled = false
    const rafId = window.requestAnimationFrame(() => {
      if (!cancelled) {
        setMounted(true)
      }
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
    }
  }, [])

  // 메일 구독 상태 조회
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/email/subscribe")
        .then((res) => res.json())
        .then((data) => {
          if (data.emailSubscription !== undefined) {
            setEmailSubscribed(data.emailSubscription)
          }
        })
        .catch((error) => {
          console.error("Error fetching email subscription:", error)
        })
    }
  }, [status])

  const handleEmailButtonClick = () => {
    if (emailSubscribed) {
      // 이미 구독 중이면 프로필 페이지로 이동
      window.location.href = "/profile"
    } else {
      // 구독 안 되어 있으면 팝업 표시
      // 다이얼로그가 열릴 때도 호버 상태 유지
      setShowSubscribeDialog(true)
    }
  }

  const handleToggleEmailSubscription = async (subscribe: boolean) => {
    if (togglingEmail || status !== "authenticated") return
    setTogglingEmail(true)
    try {
      const response = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribe }),
      })
      const data = await response.json()
      if (data.success) {
        setEmailSubscribed(data.emailSubscription === 1)
        setShowSubscribeDialog(false)
      }
    } catch (error) {
      console.error("Error toggling email subscription:", error)
    } finally {
      setTogglingEmail(false)
    }
  }

  const activeTheme = mounted ? (theme === "system" ? resolvedTheme : theme) : undefined
  const isDarkMode = activeTheme ? activeTheme !== "light" : undefined
  const toggleLabel = mounted ? `${isDarkMode ? "라이트" : "다크"} 모드로 전환` : "테마 모드 전환"
  const ThemeIcon = mounted ? (
    isDarkMode ? (
      <Sun className="w-5 h-5" />
    ) : (
      <Moon className="w-5 h-5" />
    )
  ) : (
    <span className="block w-5 h-5" aria-hidden="true" />
  )

  const redirectToLogin = async () => {
    try {
      await signOut({ callbackUrl: "/auth/login" })
    } catch (error) {
      console.error("Error while redirecting to login:", error)
    }
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      console.error("Error logging out:", error)
    } finally {
      await redirectToLogin()
      setLoggingOut(false)
    }
  }

  const userLabel = session?.user?.name || session?.user?.email || "사용자"
  const userInitial = userLabel.charAt(0).toUpperCase()

  return (
    <header className="sticky top-0 z-50 w-full glass">
      <div className="flex h-16 max-w-7xl mx-auto px-4 sm:px-6 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-xl gradient-text">
          {mounted && isDarkMode !== undefined ? (
            <Image
              src={isDarkMode ? "/icon-dark-32x32.png" : "/icon-light-32x32.png"}
              alt="NewsHub Logo"
              width={32}
              height={32}
              className="w-8 h-8 rounded-lg"
            />
          ) : (
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-lg"></div>
          )}
          NewsHub
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
            대시보드
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
          {status === "authenticated" && (
            <>
              <button
                onClick={handleEmailButtonClick}
                disabled={togglingEmail}
                className={`text-sm transition-all duration-200 flex items-center gap-1 ${emailSubscribed
                    ? "text-primary hover:text-accent"
                    : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                title={emailSubscribed ? "메일 구독 해제" : "메일 구독"}
              >
                <Mail className={`w-4 h-4 transition-all duration-200 ${emailSubscribed ? "fill-current" : ""}`} />
                <span className="hidden lg:inline">메일</span>
              </button>
              <AlertDialog open={showSubscribeDialog} onOpenChange={setShowSubscribeDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>메일 구독</AlertDialogTitle>
                    <AlertDialogDescription>
                      매일 아침 8시에 주요 뉴스를 요약해서 이메일로 받아보시겠습니까?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleToggleEmailSubscription(true)}
                      disabled={togglingEmail}
                    >
                      구독하기
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
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
            title={toggleLabel}
            aria-label={toggleLabel}
            suppressHydrationWarning
          >
            {ThemeIcon}
          </button>
          {status === "authenticated" ? (
            <>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-background/60">
                <span className="text-xs font-semibold text-primary">{userInitial}</span>
                <span className="text-sm text-muted-foreground max-w-[120px] truncate">{userLabel}</span>
              </div>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-sm text-muted-foreground hover:text-foreground transition flex items-center gap-2 disabled:opacity-60"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{loggingOut ? "로그아웃 중..." : "로그아웃"}</span>
              </button>
            </>
          ) : (
            <Link
              href="/auth/login"
              className="text-sm text-muted-foreground hover:text-foreground transition flex items-center gap-2"
            >
              로그인
            </Link>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-background/50 transition text-foreground"
            title={toggleLabel}
            aria-label={toggleLabel}
            suppressHydrationWarning
          >
            {ThemeIcon}
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
            {status === "authenticated" && (
              <button
                onClick={handleEmailButtonClick}
                disabled={togglingEmail}
                className={`text-sm transition-all duration-200 flex items-center gap-2 ${emailSubscribed
                    ? "text-primary hover:text-accent"
                    : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <Mail className={`w-4 h-4 transition-all duration-200 ${emailSubscribed ? "fill-current" : ""}`} />
                {emailSubscribed ? "메일 구독 중" : "메일 구독"}
              </button>
            )}
            {status === "authenticated" ? (
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-sm text-muted-foreground hover:text-foreground transition flex items-center gap-2 disabled:opacity-60"
              >
                <LogOut className="w-4 h-4" />
                로그아웃
              </button>
            ) : (
              <Link
                href="/auth/login"
                className="text-sm text-muted-foreground hover:text-foreground transition flex items-center gap-2"
              >
                로그인
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
