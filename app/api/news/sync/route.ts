import { NextResponse, type NextRequest } from "next/server"
import { ingestLatestNews, SUPPORTED_NEWS_CATEGORIES } from "@/lib/news-service"
import { prisma } from "@/lib/prisma"
import { getAccessToken, verifyAccessToken } from "@/lib/auth"

function getRequestCronSecret(request: NextRequest): { value: string | null; source: string } {
  const headerSecret = request.headers.get("x-cron-secret")
  if (headerSecret) {
    return { value: headerSecret, source: "x-cron-secret" }
  }

  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    return { value: authorization.slice("Bearer ".length).trim(), source: "authorization-bearer" }
  }

  return { value: null, source: "missing" }
}

async function authorize(request: NextRequest): Promise<{ ok: boolean; reason: string }> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return { ok: true, reason: "cron-secret-disabled" }
  }

  const { value, source } = getRequestCronSecret(request)
  if (value && value === cronSecret) {
    return { ok: true, reason: `authorized-via-${source}` }
  }

  const accessToken = await getAccessToken()
  if (accessToken) {
    const payload = await verifyAccessToken(accessToken)
    if (payload) {
      return { ok: true, reason: "authorized-via-user-session" }
    }
  }

  if (!value) {
    return { ok: false, reason: "missing-secret-header-and-session" }
  }

  return { ok: false, reason: `secret-mismatch-via-${source}` }
}

/**
 * 1시간 이내에 동기화가 실행되었는지 확인
 */
async function checkRecentSync(): Promise<{ canSync: boolean; lastSyncAt: Date | null }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const lastSync = await prisma.newsSyncLog.findFirst({
    where: {
      createdAt: {
        gte: oneHourAgo,
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
  const auth = await authorize(request)
  if (!auth.ok) {
    console.warn(`[news-sync] Unauthorized request: ${auth.reason}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 1시간 이내 동기화 확인
    const { canSync, lastSyncAt } = await checkRecentSync()

    if (!canSync) {
      const waitTime = lastSyncAt
        ? Math.max(0, Math.ceil((60 * 60 * 1000 - (Date.now() - lastSyncAt.getTime())) / 1000))
        : 0
      return NextResponse.json(
        {
          ok: false,
          error: "최근 1시간 이내에 동기화가 실행되었습니다.",
          lastSyncAt: lastSyncAt?.toISOString(),
          waitTime,
          message: `${waitTime}초 후에 다시 시도해주세요.`,
        },
        { status: 429 } // Too Many Requests
      )
    }

    const payload = await request.json().catch(() => ({}))
    const filteredCategories = Array.isArray(payload?.categories)
      ? payload.categories.filter((category: string) => SUPPORTED_NEWS_CATEGORIES.includes(category as any))
      : undefined
    const categories = filteredCategories && filteredCategories.length > 0 ? filteredCategories : undefined

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
    if (error instanceof Error && error.name === "PrismaClientInitializationError") {
      return NextResponse.json(
        { error: "DB 서버에 연결할 수 없습니다. 데이터베이스 상태를 확인해주세요." },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: "뉴스 동기화 실패" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}

