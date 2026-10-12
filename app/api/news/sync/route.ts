import { NextResponse, type NextRequest } from "next/server"
import { ingestLatestNews, NewsCollectionError, type NewsIngestResult } from "@/lib/news-service"
import { prisma } from "@/lib/prisma"
import { getRequestUser } from "@/lib/request-auth"
import { isAuthorizedCron } from "@/lib/cron-auth"
import { newsSyncSchema } from "@/lib/news-validation"
import { isAdminUser } from "@/lib/admin"
import { TECH_FEED_SOURCES } from "@/lib/feed-sources"

import { markInterruptedNewsSyncs, NEWS_SYNC_LEASE_MS } from "@/lib/news-sync"

export const maxDuration = 300

function collectionLogData(result: NewsIngestResult) {
  return {
    fetched: result.fetched, persisted: result.persisted, skipped: result.skipped,
    createdCount: result.createdCount, repairedCount: result.repairedCount,
    excludedCount: result.excludedCount, durationMs: result.durationMs,
    sourceReports: JSON.parse(JSON.stringify(result.sourceReports)), finishedAt: new Date(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const isCron = isAuthorizedCron(request.headers)
    const session = !isCron && await getRequestUser(request)
    if (!isCron && !session) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
    }

    const admin = session ? await isAdminUser(session.userId) : false

    // 본문이 없는 버튼/cron 호출은 기본 수집 옵션을 사용한다.
    const body = await request.text()
    let payload: unknown = {}
    if (body.trim()) {
      try {
        payload = JSON.parse(body)
      } catch {
        return NextResponse.json({ error: "JSON 형식이 올바르지 않습니다." }, { status: 400 })
      }
    }
    const options = newsSyncSchema.safeParse(payload)
    if (!options.success) {
      return NextResponse.json({ error: "수집 카테고리 또는 수량이 올바르지 않습니다." }, { status: 400 })
    }

    await markInterruptedNewsSyncs()

    // 검사와 실행 예약을 한 트랜잭션으로 묶어 동시 요청의 중복 수집을 막는다.
    const reservation = await prisma.$transaction(async (transaction) => {
      const now = Date.now()
      const lastSync = await transaction.newsSyncLog.findFirst({
        where: {
          OR: [
            ...(!admin ? [{ status: { in: ["success", "partial"] }, createdAt: { gte: new Date(now - 3_600_000) } }] : []),
            { status: "processing", createdAt: { gte: new Date(now - NEWS_SYNC_LEASE_MS) } },
          ],
        },
        orderBy: { createdAt: "desc" },
      })
      if (lastSync) return { lastSync, syncLog: null }
      const syncLog = await transaction.newsSyncLog.create({ data: { status: "processing" } })
      return { lastSync: null, syncLog }
    }, { isolationLevel: "Serializable" })

    if (reservation.lastSync) {
      const lastSync = reservation.lastSync
      const duration = lastSync.status === "processing" ? NEWS_SYNC_LEASE_MS : 3_600_000
      const waitTime = Math.max(1, Math.ceil((duration - (Date.now() - lastSync.createdAt.getTime())) / 1000))
      return NextResponse.json({
        ok: false,
        error: lastSync.status === "processing" ? "뉴스 수집이 진행 중입니다." : "최근 1시간 이내에 동기화가 실행되었습니다.",
        lastSyncAt: lastSync.createdAt.toISOString(),
        waitTime,
        message: `${waitTime}초 후에 다시 시도해주세요.`,
      }, { status: 429, headers: { "Retry-After": String(waitTime) } })
    }

    const syncLog = reservation.syncLog!
    try {
      const result = await ingestLatestNews(options.data)
      const failures = [
        result.failedCategories.length ? `수집 실패 카테고리: ${result.failedCategories.join(", ")}` : "",
        result.failedSources.length ? `수집 실패 소스: ${result.failedSources.map((id) => TECH_FEED_SOURCES.find((source) => source.id === id)?.name ?? id).join(", ")}` : "",
      ].filter(Boolean)
      const partial = failures.length > 0 || result.sourceReports.some((source) => source.status !== "success")
      await prisma.newsSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: partial ? "partial" : "success",
          ...collectionLogData(result),
          error: partial ? failures.join("; ") || "일부 항목을 제외했습니다. 출처별 기록을 확인하세요." : null,
        },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (error) {
      await prisma.newsSyncLog.update({
        where: { id: syncLog.id },
        data: { status: "failed", ...(error instanceof NewsCollectionError ? collectionLogData(error.result) : { finishedAt: new Date() }), error: error instanceof Error ? error.message : "수집 오류" },
      })
      throw error
    }
  } catch (error) {
    console.error("뉴스 동기화 실패:", error)
    if (error instanceof Error && error.name === "PrismaClientInitializationError") {
      return NextResponse.json({ error: "DB 서버에 연결할 수 없습니다. 데이터베이스 상태를 확인해주세요." }, { status: 503 })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      return NextResponse.json({ error: "다른 수집 요청과 충돌했습니다. 잠시 후 다시 시도해주세요." }, { status: 409 })
    }
    return NextResponse.json({ error: "뉴스 동기화 실패" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers)) {
    return NextResponse.json({ error: "자동 수집 인증이 필요합니다." }, { status: 401 })
  }
  return POST(request)
}