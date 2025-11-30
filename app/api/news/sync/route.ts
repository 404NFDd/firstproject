import { NextResponse, type NextRequest } from "next/server"
import { ingestLatestNews, SUPPORTED_NEWS_CATEGORIES } from "@/lib/news-service"
import { prisma } from "@/lib/prisma"

function authorize(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return true
  }

  const headerValue = request.headers.get("x-cron-secret")
  return headerValue === cronSecret
}

/**
 * 10분 이내에 동기화가 실행되었는지 확인
 */
async function checkRecentSync(): Promise<{ canSync: boolean; lastSyncAt: Date | null }> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

  const lastSync = await prisma.newsSyncLog.findFirst({
    where: {
      createdAt: {
        gte: tenMinutesAgo,
      },
      status: "success",
    },
    orderBy: {
      createdAt: "desc",
    },
  })

  return {
    canSync: !lastSync,
    lastSyncAt: lastSync?.createdAt || null,
  }
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 10분 이내 동기화 확인
    const { canSync, lastSyncAt } = await checkRecentSync()

    if (!canSync) {
      const waitTime = lastSyncAt
        ? Math.ceil((10 * 60 * 1000 - (Date.now() - lastSyncAt.getTime())) / 1000)
        : 0
      return NextResponse.json(
        {
          ok: false,
          error: "최근 10분 이내에 동기화가 실행되었습니다.",
          lastSyncAt: lastSyncAt?.toISOString(),
          waitTime,
          message: `${waitTime}초 후에 다시 시도해주세요.`,
        },
        { status: 429 } // Too Many Requests
      )
    }

    const payload = await request.json().catch(() => ({}))
    const categories = Array.isArray(payload?.categories)
      ? payload.categories.filter((category: string) => SUPPORTED_NEWS_CATEGORIES.includes(category as any))
      : undefined

    // 동기화 시작 로그
    const syncLog = await prisma.newsSyncLog.create({
      data: {
        status: "processing",
        fetched: 0,
        persisted: 0,
        skipped: 0,
      },
    })

    try {
      const result = await ingestLatestNews({
        categories,
        limitPerCategory: payload?.limitPerCategory,
        includeRss: payload?.includeRss,
        rssLimit: payload?.rssLimit,
      })

      // 성공 로그 업데이트
      await prisma.newsSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "success",
          fetched: result.fetched,
          persisted: result.persisted,
          skipped: result.skipped,
        },
      })

      return NextResponse.json({
        ok: true,
        ...result,
      })
    } catch (error) {
      // 실패 로그 업데이트
      await prisma.newsSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      throw error
    }
  } catch (error) {
    console.error("Error syncing news:", error)
    return NextResponse.json({ error: "뉴스 동기화 실패" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}

