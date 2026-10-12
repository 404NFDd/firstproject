import { prisma } from "@/lib/prisma"

// 수집 요청은 4분 안에 중단하고, 기록이 남지 않은 실행은 5분 뒤 식별합니다.
export const NEWS_SYNC_TIMEOUT_MS = 240_000
export const NEWS_SYNC_PERSIST_TIMEOUT_MS = 30_000
export const NEWS_SYNC_LEASE_MS = 300_000

export async function markInterruptedNewsSyncs(now = new Date()) {
  return prisma.newsSyncLog.updateMany({
    where: { status: "processing", createdAt: { lte: new Date(now.getTime() - NEWS_SYNC_LEASE_MS) } },
    data: { status: "interrupted", finishedAt: now, error: "수집 실행이 중단되어 완료 기록이 없습니다. 다시 수집할 수 있습니다." },
  })
}
