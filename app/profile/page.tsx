"use client"

import { useState, useEffect, useRef } from "react"
import { Header } from "@/components/header"
import { User, Mail, LogOut, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
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

interface UserProfile {
  id: string
  email: string
  name: string | null
  image?: string | null
}

export default function ProfilePage() {
  const router = useRouter()
  const { data: session, status, update } = useSession()
  const { toast } = useToast()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [reload, setReload] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ name: "" })
  const [emailSubscribed, setEmailSubscribed] = useState(false)
  const [showUnsubscribeDialog, setShowUnsubscribeDialog] = useState(false)
  const [togglingEmail, setTogglingEmail] = useState(false)
  const [sendingTestEmail, setSendingTestEmail] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const subscriptionVersion = useRef(0)
  const savingProfileRef = useRef(false)
  const togglingEmailRef = useRef(false)
  const sendingTestEmailRef = useRef(false)
  const loggingOutRef = useRef(false)

  useEffect(() => {
    if (status === "loading") return
    if (status === "unauthenticated") {
      router.replace("/auth/login")
      return
    }
    const controller = new AbortController()
    requestController.current = controller
    const version = ++subscriptionVersion.current
    const fetchUser = async () => {
      setLoading(true)
      setLoadError("")
      try {
        const response = await fetch("/api/auth/me", { signal: controller.signal })
        const data = await response.json()
        if (response.status === 401) {
          toast({ title: "로그인이 필요합니다", description: "다시 로그인해 주세요." })
          router.replace("/auth/login")
          return
        }
        if (!response.ok) throw new Error(data.error || "프로필을 불러오지 못했습니다.")

        const subscribeResponse = await fetch("/api/email/subscribe", { signal: controller.signal })
        const subscribeData = await subscribeResponse.json()
        if (subscribeResponse.status === 401) {
          router.replace("/auth/login")
          return
        }
        if (!subscribeResponse.ok || typeof subscribeData.emailSubscription !== "boolean") {
          throw new Error(subscribeData.error || "구독 상태를 불러오지 못했습니다.")
        }
        if (controller.signal.aborted) return
        setUser(data.user)
        setFormData({ name: data.user.name ?? "" })
        if (version === subscriptionVersion.current) setEmailSubscribed(subscribeData.emailSubscription)
      } catch (error) {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : "프로필을 불러오지 못했습니다.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void fetchUser()
    return () => {
      controller.abort()
      if (requestController.current === controller) requestController.current = null
    }
  }, [status, session?.user?.id, reload, router, toast])

  useEffect(() => {
    const onSubscriptionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: unknown; subscribed?: unknown }>).detail
      if (status !== "authenticated" || !detail || detail.userId !== session?.user?.id || typeof detail.subscribed !== "boolean") return
      subscriptionVersion.current++
      setEmailSubscribed(detail.subscribed)
    }
    window.addEventListener("email-subscription-changed", onSubscriptionChange)
    return () => window.removeEventListener("email-subscription-changed", onSubscriptionChange)
  }, [status, session?.user?.id])

  const readResponse = async (response: Response, fallback: string) => {
    const data = await response.json().catch(() => null)
    if (response.status === 401) router.replace("/auth/login")
    if (!response.ok) throw new Error(data?.error || fallback)
    if (!data) throw new Error(fallback)
    return data
  }

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

  const handleSaveProfile = async () => {
    if (savingProfileRef.current || status !== "authenticated" || !user) return
    savingProfileRef.current = true
    setSavingProfile(true)
    const signal = requestController.current?.signal
    try {
      const data = await readResponse(await fetch("/api/auth/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData), signal,
      }), "프로필을 저장하지 못했습니다.")
      if (signal?.aborted) return
      if (!data.user) throw new Error("저장된 프로필을 확인하지 못했습니다.")
      setUser(data.user)
      setFormData({ name: data.user.name ?? "" })
      setIsEditing(false)
      toast({ title: "프로필을 저장했습니다" })
      try {
        const updatedSession = await update()
        if (!updatedSession || updatedSession.user?.name !== data.user.name) throw new Error("세션 표시 갱신 실패")
      } catch {
        toast({
          title: "프로필은 저장했습니다",
          description: "로그인 표시를 갱신하지 못했습니다. 다시 로그인하면 저장한 이름이 표시됩니다.",
        })
      }
    } catch (error) {
      if (!signal?.aborted) toast({ title: "프로필 저장 실패", description: error instanceof Error ? error.message : "다시 시도해 주세요.", variant: "destructive" })
    } finally {
      savingProfileRef.current = false
      setSavingProfile(false)
    }
  }

  const handleToggleEmailSubscription = async (subscribe: boolean) => {
    if (togglingEmailRef.current || status !== "authenticated" || !user) return
    togglingEmailRef.current = true
    setTogglingEmail(true)
    const signal = requestController.current?.signal
    try {
      const data = await readResponse(await fetch("/api/email/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscribe }), signal,
      }), "구독 설정을 변경하지 못했습니다.")
      if (signal?.aborted) return
      if (!data.success || ![0, 1].includes(data.emailSubscription)) throw new Error("구독 변경 결과를 확인하지 못했습니다.")
      setEmailSubscribed(data.emailSubscription === 1)
      setShowUnsubscribeDialog(false)
      window.dispatchEvent(new CustomEvent("email-subscription-changed", {
        detail: { userId: user.id, subscribed: data.emailSubscription === 1 },
      }))
      toast({ title: data.message || "구독 설정을 변경했습니다" })
    } catch (error) {
      if (!signal?.aborted) toast({ title: "구독 변경 실패", description: error instanceof Error ? error.message : "다시 시도해 주세요.", variant: "destructive" })
    } finally {
      togglingEmailRef.current = false
      setTogglingEmail(false)
    }
  }

  const handleUnsubscribeClick = () => setShowUnsubscribeDialog(true)

  const handleSendTestEmail = async () => {
    if (sendingTestEmailRef.current || status !== "authenticated" || !user) return
    sendingTestEmailRef.current = true
    setSendingTestEmail(true)
    const signal = requestController.current?.signal
    try {
      const data = await readResponse(await fetch("/api/email/test-briefing", { method: "POST", signal }), "테스트 메일 발송에 실패했습니다.")
      if (signal?.aborted) return
      if (!data.success) throw new Error(data.error || "테스트 메일 발송에 실패했습니다.")
      toast({ title: data.skipped ? "발송할 뉴스가 없습니다" : "테스트 메일을 전송했습니다", description: data.message })
    } catch (error) {
      if (!signal?.aborted) toast({ title: "테스트 메일 발송 실패", description: error instanceof Error ? error.message : "다시 시도해 주세요.", variant: "destructive" })
    } finally {
      sendingTestEmailRef.current = false
      setSendingTestEmail(false)
    }
  }
  if (loading || status !== "authenticated") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  if (loadError || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <p role="alert" className="text-destructive">{loadError || "프로필을 불러오지 못했습니다."}</p>
          <button onClick={() => setReload((value) => value + 1)} className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground">다시 시도</button>
        </main>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="md:col-span-1">
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4">
                  <User className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold text-foreground">{user?.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">{user?.email}</p>
              </div>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition"
              >
                <LogOut className="w-4 h-4" />
                {loggingOut ? "로그아웃 중..." : "로그아웃"}
              </button>
            </div>
          </div>

          {/* Profile Settings */}
          <div className="md:col-span-2">
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-2xl font-bold text-foreground mb-6">프로필 설정</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">이름</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={formData.name}
                      maxLength={191}
                      disabled={savingProfile}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : (
                    <p className="text-foreground">{user?.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    이메일
                  </label>
                  <p className="text-muted-foreground">{user?.email}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    메일 구독
                  </label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-foreground">
                        {emailSubscribed ? (
                          <span className="text-primary font-medium">구독 중 (종합 뉴스 브리핑)</span>
                        ) : (
                          <span className="text-muted-foreground">구독하지 않음</span>
                        )}
                      </p>
                      {emailSubscribed ? (
                        <button
                          onClick={handleUnsubscribeClick}
                          disabled={togglingEmail}
                          className="px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-input transition disabled:opacity-60"
                        >
                          구독 해제
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleEmailSubscription(true)}
                          disabled={togglingEmail}
                          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-60"
                        >
                          구독하기
                        </button>
                      )}
                    </div>
                    <div className="pt-2 border-t border-border">
                      <button
                        onClick={handleSendTestEmail}
                        disabled={sendingTestEmail}
                        className="w-full px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-input transition disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {sendingTestEmail ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            전송 중...
                          </>
                        ) : (
                          <>
                            <Mail className="w-4 h-4" />
                            테스트 메일 보내기
                          </>
                        )}
                      </button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        현재 로그인한 이메일로 테스트 메일을 전송합니다. 자동 발송이 설정된 환경에서는 한국 시각 오전 7시에 브리핑을 보냅니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSaveProfile}
                      disabled={savingProfile}
                      className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
                    >
                      {savingProfile ? "저장 중..." : "저장"}
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); setFormData({ name: user.name ?? "" }) }}
                      disabled={savingProfile}
                      className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-input transition"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
                  >
                    편집
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 구독 해제 확인 다이얼로그 */}
      <AlertDialog open={showUnsubscribeDialog} onOpenChange={setShowUnsubscribeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>메일 구독 해제</AlertDialogTitle>
            <AlertDialogDescription>
              메일 구독을 해제하시겠습니까? 해제하시면 더 이상 일일 브리핑 메일을 받지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleToggleEmailSubscription(false)}
              disabled={togglingEmail}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              해제하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
