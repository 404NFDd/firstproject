import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminAccess } from "@/lib/admin"

import { getBriefingDateKey, markInterruptedBriefings } from "@/lib/daily-briefing"
import { markInterruptedNewsSyncs } from "@/lib/news-sync"

export async function GET(request: NextRequest) {
  try {
    const access = await getAdminAccess(request)
    if (!access.allowed) return NextResponse.json({ error: access.status === 401 ? "로그인이 필요합니다." : "관리자만 접근할 수 있습니다." }, { status: access.status })
    const page = z.coerce.number().int().min(1).max(1_000_000).safeParse(request.nextUrl.searchParams.get("page") ?? 1)
    if (!page.success) return NextResponse.json({ error: "페이지 번호를 확인하세요." }, { status: 400 })
    const limit = 20
    const dateKey = getBriefingDateKey()
    await Promise.all([markInterruptedNewsSyncs(), markInterruptedBriefings()])
    const [totalUsers, subscribers, totalNews, users, syncLogs, deliveryCounts, deliveries] = await Promise.all([
      prisma.user.count({ where: { isAdmin: false } }),
      prisma.user.count({ where: { isAdmin: false, emailSubscription: 1 } }),
      prisma.news.count(),
      prisma.user.findMany({
        where: { isAdmin: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page.data - 1) * limit, take: limit,
        select: { id: true, name: true, email: true, emailSubscription: true, createdAt: true },
      }),
      prisma.newsSyncLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10,
        select: { id: true, status: true, fetched: true, persisted: true, skipped: true, error: true, createdAt: true,
          createdCount: true, repairedCount: true, excludedCount: true, durationMs: true, sourceReports: true, finishedAt: true } }),
      prisma.briefingDelivery.groupBy({ by: ["status"], where: { dateKey }, _count: { _all: true } }),
      prisma.briefingDelivery.findMany({
        where: { dateKey }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 20,
        select: { id: true, status: true, attempts: true, startedAt: true, sentAt: true, error: true,
          user: { select: { name: true, email: true } } },
      }),
    ])
    return NextResponse.json({ stats: { totalUsers, subscribers, totalNews }, users, syncLogs,
      briefing: { dateKey, counts: Object.fromEntries(deliveryCounts.map((row) => [row.status, row._count._all])), deliveries },
      pagination: { page: page.data, pages: Math.ceil(totalUsers / limit), total: totalUsers } }, { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "관리자 정보를 불러오지 못했습니다." }, { status: 500 })
  }
}
