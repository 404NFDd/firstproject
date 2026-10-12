"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CollectionReport } from "@/lib/collection-report"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

interface DashboardData {
  stats: { totalUsers: number; subscribers: number; totalNews: number }
  users: { id: string; name: string | null; email: string; emailSubscription: number; createdAt: string }[]
  syncLogs: { id: string; status: string; fetched: number; persisted: number; skipped: number; error: string | null; createdAt: string; createdCount: number; repairedCount: number; excludedCount: number; durationMs: number; finishedAt: string | null; sourceReports: CollectionReport[] | null }[]
  briefing: {
    dateKey: string
    counts: Record<string, number>
    deliveries: { id: string; status: string; attempts: number; startedAt: string; sentAt: string | null; error: string | null; user: { name: string | null; email: string } }[]
  }
  pagination: { page: number; pages: number; total: number }
}
const statusLabels: Record<string, string> = { processing: "진행 중", success: "성공", partial: "부분 성공", failed: "실패", interrupted: "중단", sent: "발송 완료", unknown: "확인 필요" }
const reasonLabels: Record<string, string> = {
  invalid_title: "제목 없음", invalid_url: "유효하지 않은 주소", invalid_date: "유효하지 않은 날짜",
  invalid_item: "유효하지 않은 항목", invalid_source: "출처 없음",
  duplicate_url: "같은 주소 중복", missing_content: "본문 없음", timeout: "시간 초과",
  source_error: "출처 요청/해석 실패", database_error: "저장 실패",
}
const formatDate = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })

export function AdminDashboard() {
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<DashboardData | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const syncLock = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`/api/admin/dashboard?page=${page}`, { cache: "no-store", signal: controller.signal })
      const result = await response.json()
      if (response.status === 401) router.replace("/auth/login")
      if (response.status === 403) router.replace("/")
      if (!response.ok) throw new Error(result.error || "조회 실패")
      if (!controller.signal.aborted) setData(result)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "조회 실패")
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [page, router])
  useEffect(() => { void load(); return () => controllerRef.current?.abort() }, [load])

  const collect = async (scope: "tech" | "all") => {
    if (syncLock.current) return
    syncLock.current = true
    setSyncing(true)
    try {
      const response = await fetch("/api/news/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) })
      const result = await response.json()
      if (response.status === 401) router.replace("/auth/login")
      if (!response.ok) throw new Error(result.message || result.error || "뉴스 수집 실패")
      const partial = result.failedCategories?.length || result.failedSources?.length || result.excludedCount
      toast({ title: partial ? "일부 수집 완료" : "수집 완료", description: `신규 ${result.createdCount}건 / 본문 보강 ${result.repairedCount}건 / 중복 ${result.skipped}건 / 제외 ${result.excludedCount}건${partial ? " · 실패 출처는 수집 기록을 확인하세요." : ""}` })
    } catch (error) {
      toast({ title: "수집 알림", description: error instanceof Error ? error.message : "뉴스 수집 실패", variant: "destructive" })
    } finally {
      syncLock.current = false
      setSyncing(false)
      await load()
    }
  }

  return <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
    <div><h1 className="text-3xl font-bold">관리자 대시보드</h1><p className="mt-2 text-muted-foreground">회원가입 정보와 뉴스 수집 상태를 확인합니다. 모든 시각은 한국 시간 기준입니다.</p></div>
    <div className="flex flex-wrap gap-3">
      <button onClick={() => void collect("tech")} disabled={syncing} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">{syncing ? "수집 중…" : "뉴스 수집"}</button>
      <button onClick={() => void collect("all")} disabled={syncing} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">전체 뉴스 수집</button>
      <button onClick={() => void load()} disabled={loading} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">새로고침</button>
      <Link href="/" className="px-4 py-2 text-primary hover:underline">뉴스 피드 보기</Link>
    </div>
    <p className="text-sm text-muted-foreground">관리자는 최근 성공한 수집의 1시간 제한 없이 다시 수집할 수 있습니다. 다른 수집이 진행 중이면 완료 후 실행합니다. 중단된 실행은 5분 뒤 다시 수집할 수 있습니다.</p>
    {error && <div role="alert" className="text-destructive">{error}</div>}
    {loading && <p role="status">관리자 정보를 불러오는 중입니다…</p>}
    {!loading && !error && data && <>
      <section aria-label="운영 현황" className="grid gap-4 sm:grid-cols-3">
        {[['가입 회원', data.stats.totalUsers], ['메일 구독 회원', data.stats.subscribers], ['저장된 뉴스', data.stats.totalNews]].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>)}
      </section>
      <section><h2 className="text-xl font-semibold mb-4">회원가입자 정보</h2>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm text-left"><thead className="bg-muted"><tr>{['이름', '이메일', '메일 구독', '가입 시각'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{data.users.map((user) => <tr key={user.id} className="border-t border-border"><td className="p-3">{user.name || '이름 없음'}</td><td className="p-3">{user.email}</td><td className="p-3">{user.emailSubscription === 1 ? '구독 중' : '미구독'}</td><td className="p-3 whitespace-nowrap">{formatDate(user.createdAt)}</td></tr>)}{!data.users.length && <tr><td colSpan={4} className="p-5 text-center text-muted-foreground">가입 회원이 없습니다.</td></tr>}</tbody></table></div>
        <div className="flex items-center gap-4 mt-4"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="disabled:opacity-40">이전</button><span>{page} / {Math.max(1, data.pagination.pages)}</span><button disabled={page >= data.pagination.pages} onClick={() => setPage((value) => value + 1)} className="disabled:opacity-40">다음</button></div>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-4">최근 수집 기록</h2>
        <div className="space-y-3">
          {data.syncLogs.map((log) => <div key={log.id} className="rounded-xl border border-border bg-card p-4">
            <p className="font-medium">{statusLabels[log.status] || log.status} / {formatDate(log.createdAt)}</p>
            {log.sourceReports?.length ? <p className="text-sm mt-1">
              신규 {log.createdCount} / 본문 보강 {log.repairedCount} / 기존 중복 {log.skipped} / 제외 {log.excludedCount} / {(log.durationMs / 1000).toFixed(1)}초
            </p> : <p className="text-sm mt-1">수집 {log.fetched} / 저장 {log.persisted} / 중복 {log.skipped}</p>}
            {log.error && <p className="mt-2 text-sm text-destructive break-words">{log.error}</p>}
            {Array.isArray(log.sourceReports) && log.sourceReports.length > 0 && <details className="mt-3">
              <summary className="cursor-pointer text-sm text-primary">출처별 수집 결과</summary>
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm text-left">
                  <thead><tr>{["출처", "상태", "확인", "수집", "제외", "본문 없음", "소요 시간", "사유"].map((label) => <th key={label} className="p-2 whitespace-nowrap">{label}</th>)}</tr></thead>
                  <tbody>{log.sourceReports.map((report) => <tr key={report.id} className="border-t border-border">
                    <td className="p-2">{report.name}</td><td className="p-2">{statusLabels[report.status]}</td>
                    <td className="p-2">{report.received}</td><td className="p-2">{report.accepted}</td><td className="p-2">{report.excluded}</td>
                    <td className="p-2">{report.missingContent}</td><td className="p-2 whitespace-nowrap">{(report.durationMs / 1000).toFixed(1)}초</td>
                    <td className="p-2">{Object.entries(report.reasons).map(([reason, count]) => (reasonLabels[reason] || reason) + " " + count + "건").join(", ") || report.error || "없음"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>}
          </div>)}
          {!data.syncLogs.length && <p className="text-muted-foreground">수집 기록이 없습니다.</p>}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-4">오늘의 브리핑 발송 / {data.briefing.dateKey}</h2>
        <div className="flex flex-wrap gap-4 text-sm mb-4">
          {["sent", "failed", "processing", "unknown"].map((status) => <p key={status}>{statusLabels[status]} {data.briefing.counts[status] || 0}건</p>)}
        </div>
        <p className="text-sm text-muted-foreground mb-4">발송 완료 대상은 다시 보내지 않습니다. 확인 필요 상태는 메일 서버 결과를 확인하기 전까지 자동 재발송을 보류합니다.</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted"><tr>{["수신자", "상태", "시도", "시각", "안내"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
            <tbody>{data.briefing.deliveries.map((delivery) => <tr key={delivery.id} className="border-t border-border">
              <td className="p-3">{delivery.user.name || delivery.user.email}</td><td className="p-3">{statusLabels[delivery.status] || delivery.status}</td>
              <td className="p-3">{delivery.attempts}</td><td className="p-3 whitespace-nowrap">{formatDate(delivery.sentAt || delivery.startedAt)}</td>
              <td className="p-3">{delivery.error || "없음"}</td>
            </tr>)}
            {!data.briefing.deliveries.length && <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">오늘의 정기 발송 기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </main>
}
