"use client"

import { useState, useEffect, useRef } from "react"
import { Menu, X, Search, LogOut, Sun, Moon, Mail } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { useTheme } from "@/components/theme-provider"
import { useToast } from "@/hooks/use-toast"
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
  const router = useRouter()
  const { toast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [emailSubscribed, setEmailSubscribed] = useState<boolean | null>(null)
  const [subscriptionError, setSubscriptionError] = useState(false)
  const [subscriptionReload, setSubscriptionReload] = useState(0)
  const [togglingEmail, setTogglingEmail] = useState(false)
  const [showSubscribeDialog, setShowSubscribeDialog] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const subscriptionVersion = useRef(0)
  const togglingEmailRef = useRef(false)
  const loggingOutRef = useRef(false)
  const { data: session, status } = useSession()
  const { theme, resolvedTheme, toggleTheme } = useTheme()

  useEffect(() => {
    let cancelled = false
    const rafId = window.requestAnimationFrame(() => {
      if (!cancelled) setMounted(true)
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    if (status !== "authenticated") return
    const controller = new AbortController()
    requestController.current = controller
    const version = ++subscriptionVersion.current
    const fetchSubscription = async () => {
      setEmailSubscribed(null)
      setSubscriptionError(false)
      try {
        const response = await fetch("/api/email/subscribe", { signal: controller.signal })
        const data = await response.json()
        if (controller.signal.aborted || version !== subscriptionVersion.current) return
        if (response.status === 401) router.replace("/auth/login")
        if (!response.ok || typeof data.emailSubscription !== "boolean") {
          throw new Error(data.error || "구독 상태를 확인하지 못했습니다.")
        }
        setEmailSubscribed(data.emailSubscription)
      } catch (error) {
        if (controller.signal.aborted || version !== subscriptionVersion.current) return
        setSubscriptionError(true)
        toast({ title: "구독 상태 조회 실패", description: error instanceof Error ? error.message : "메일 버튼으로 다시 시도해 주세요.", variant: "destructive" })
      }
    }
    void fetchSubscription()
    return () => {
      controller.abort()
      if (requestController.current === controller) requestController.current = null
    }
  }, [status, session?.user?.id, subscriptionReload, router, toast])

  useEffect(() => {
    const onSubscriptionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: unknown; subscribed?: unknown }>).detail
      if (status !== "authenticated" || !detail || detail.userId !== session?.user?.id || typeof detail.subscribed !== "boolean") return
      subscriptionVersion.current++
      setEmailSubscribed(detail.subscribed)
      setSubscriptionError(false)
    }
    window.addEventListener("email-subscription-changed", onSubscriptionChange)
    return () => window.removeEventListener("email-subscription-changed", onSubscriptionChange)
  }, [status, session?.user?.id])

  const handleEmailButtonClick = () => {
    setMenuOpen(false)
    if (emailSubscribed === null) {
      setSubscriptionReload((value) => value + 1)
    } else if (emailSubscribed) {
      router.push("/profile")
    } else {
      setShowSubscribeDialog(true)
    }
  }

  const handleToggleEmailSubscription = async (subscribe: boolean) => {
    if (togglingEmailRef.current || status !== "authenticated" || !session?.user?.id) return
    togglingEmailRef.current = true
    setTogglingEmail(true)
    const signal = requestController.current?.signal
    try {
      const response = await fetch("/api/email/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscribe }), signal,
      })
      const data = await response.json()
      if (signal?.aborted) return
      if (response.status === 401) router.replace("/auth/login")
      if (!response.ok || !data.success || ![0, 1].includes(data.emailSubscription)) {
        throw new Error(data.error || "구독 설정을 변경하지 못했습니다.")
      }
      setEmailSubscribed(data.emailSubscription === 1)
      setShowSubscribeDialog(false)
      window.dispatchEvent(new CustomEvent("email-subscription-changed", {
        detail: { userId: session.user.id, subscribed: data.emailSubscription === 1 },
      }))
      toast({ title: data.message || "구독 설정을 변경했습니다" })
    } catch (error) {
      if (!signal?.aborted) toast({ title: "구독 변경 실패", description: error instanceof Error ? error.message : "다시 시도해 주세요.", variant: "destructive" })
    } finally {
      togglingEmailRef.current = false
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

  const handleLogout = async () => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    setLoggingOut(true)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      const cleanupFailed = response.status === 500
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        if (!cleanupFailed) throw new Error(data?.error || "로그아웃에 실패했습니다.")
        // 서버는 DB 정리에 실패해도 인증 쿠키를 지웁니다.
        toast({
          title: "로그아웃 처리 알림",
          description: "로그인 정보는 지웠지만 서버의 토큰 정리에 실패했습니다.",
          variant: "destructive",
        })
      }
      try {
        await signOut({ redirect: false })
      } catch (error) {
        console.error("로그아웃 화면 갱신 실패:", error)
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" })
        const serverSession: unknown = await sessionResponse.json().catch(() => null)
        if (!sessionResponse.ok || !serverSession || typeof serverSession !== "object" ||
          Array.isArray(serverSession) || Object.keys(serverSession).length !== 0) {
          throw new Error("로그아웃 상태를 확인하지 못했습니다. 다시 시도해 주세요.")
        }
        // 현재 탭의 SessionProvider 캐시도 새 페이지에서 초기화합니다.
        window.location.assign(new URL("/auth/login", window.location.origin).href)
        return
      }
      if (!cleanupFailed) toast({ title: "로그아웃되었습니다" })
      router.replace("/auth/login")
      router.refresh()
    } catch (error) {
      toast({ title: "로그아웃 실패", description: error instanceof Error ? error.message : "다시 시도해 주세요.", variant: "destructive" })
    } finally {
      loggingOutRef.current = false
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
          {session?.user?.isAdmin && <Link href="/admin" className="text-sm text-primary hover:underline">관리자</Link>}
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
            대시보드
          </Link>
          <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground transition">
            프로필
          </Link>
          {status === "authenticated" && (
            <>
              <button
                onClick={handleEmailButtonClick}
                disabled={togglingEmail || (emailSubscribed === null && !subscriptionError)}
                className={`text-sm transition-all duration-200 flex flex-col items-center gap-0.5 ${emailSubscribed
                    ? "text-primary hover:text-accent"
                    : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                title={subscriptionError ? "구독 상태 다시 확인" : emailSubscribed ? "메일 구독 관리" : "메일 구독"}
              >
                <div className="flex items-center gap-1">
                  <Mail className="w-4 h-4" />
                  <span className="hidden lg:inline">{subscriptionError ? "메일 상태 재확인" : "메일"}</span>
                </div>
                {emailSubscribed && (
                  <span className="text-[10px] text-muted-foreground leading-none">구독중</span>
                )}
              </button>
              <AlertDialog open={showSubscribeDialog} onOpenChange={setShowSubscribeDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>메일 구독</AlertDialogTitle>
                    <AlertDialogDescription>
                      지난 24시간의 종합 뉴스 브리핑을 계정 이메일로 받습니다. 자동 발송이 설정된 환경에서는 한국 시각 오전 7시에 보냅니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleToggleEmailSubscription(true)}
                      disabled={togglingEmail || (emailSubscribed === null && !subscriptionError)}
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
            {session?.user?.isAdmin && <Link href="/admin" onClick={() => setMenuOpen(false)} className="text-sm text-primary hover:underline">관리자</Link>}
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition">
              대시보드
            </Link>
            <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground transition">
              프로필
            </Link>
            {status === "authenticated" && (
              <button
                onClick={handleEmailButtonClick}
                disabled={togglingEmail || (emailSubscribed === null && !subscriptionError)}
                className={`text-sm transition-all duration-200 flex flex-col items-center gap-0.5 ${emailSubscribed
                    ? "text-primary hover:text-accent"
                    : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span>{subscriptionError ? "메일 상태 재확인" : "메일"}</span>
                </div>
                {emailSubscribed && (
                  <span className="text-[10px] text-muted-foreground leading-none">구독중</span>
                )}
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
