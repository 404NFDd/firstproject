import { setTimeout as delay } from "node:timers/promises"
import { prisma } from "../lib/prisma"
import { enqueueExistingNews, getTranslationQueueSummary, processTranslationQueueStep, getTranslationErrorMessage } from "../lib/news-translation"

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
process.once("SIGTERM", () => controller.abort())

async function main() {
  if (process.argv.includes("--status")) {
    const status = await getTranslationQueueSummary()
    const count = (value: number) => value.toLocaleString("ko-KR")
    const minutes = Math.ceil(status.retryAfterSeconds / 60)
    const waiting = status.retryAfterSeconds < 60 ? status.retryAfterSeconds + "초"
      : minutes < 60 ? minutes + "분" : Math.floor(minutes / 60) + "시간 " + minutes % 60 + "분"
    console.log([
      "",
      "기사 선별·요약·번역 현황",
      "처리 설정: " + (status.enabled ? "켜짐" : "꺼짐 — 환경 설정을 확인해 주세요."),
      "전체 대상: " + count(status.totalArticles) + "건",
      "처리 완료: " + count(status.completedArticles) + "건",
      "선별 채택: " + count(status.selectedArticles) + "건 / 제외: " + count(status.rejectedArticles) + "건",
      "처리 대기: " + count(status.pendingArticles) + "건 (진행 중·재시도 포함)",
      "오늘 AI 요청: " + count(status.requests) + " / " + count(status.dailyLimit) + "회 (남은 " + count(Math.max(0, status.dailyLimit - status.requests)) + "회)",
      "기억한 현재 모델: " + status.currentModel,
      "다음 사용 모델: " + (status.model || "모든 모델이 대기 중"),
      ...status.models.map((model) => "  " + model.model + ": " + count(model.requests) + " / " + count(model.dailyLimit) + "회 — " +
        ({ daily_limit: "앱 일일 한도 도달", api_wait: "API 한도·오류 대기", interval: "요청 간격 대기", available: "앱 기록상 요청 가능" }[model.quotaStatus]) +
        (model.retryAfterSeconds ? " (" + model.retryAfterSeconds + "초 후)" : "")),
      ...(status.failedJobs ? ["재시도가 필요한 처리 작업: " + count(status.failedJobs) + "개 (자동 재시도 예정)"] : []),
      ...(status.enabled ? ["다음 요청: " + (status.retryAfterSeconds ? waiting + " 후 가능" : "바로 처리 가능")] : []),
      "",
      "선별·요약과 전체 번역은 모델별 요청 한도를 함께 사용하며, 한도에 걸리면 다음 모델로 전환합니다.",
      "이 명령은 조회만 합니다. 사이트를 실행해 두면 처리가 자동으로 진행됩니다.",
      "",
    ].join("\n"))
    return
  }
  const registered = await enqueueExistingNews()
  console.log("[번역 큐] 기존 기사 검사: " + JSON.stringify(registered))
  if (process.argv.includes("--enqueue-only")) {
    console.log(JSON.stringify(await getTranslationQueueSummary()))
    return
  }
  let lastWaitingReason = ""
  while (!controller.signal.aborted) {
    try {
      const step = await processTranslationQueueStep()
      if (step.processed) {
        lastWaitingReason = ""
        const operation = step.operation
        if (operation) {
          for (const attempt of operation.attempts) {
            if (attempt.outcome === "success") continue
            const label = { quota: "한도 도달", unavailable: "모델 사용 불가", temporary: "일시 오류", skipped: "모델 건너뜀", failed: "요청 실패" }[attempt.outcome]
            console.log("[번역 큐] " + label + " " + JSON.stringify({ newsId: step.newsId, ...attempt }))
          }
          for (const change of operation.modelSwitches) console.log("[번역 큐] 모델 전환 " + JSON.stringify({ newsId: step.newsId, ...change }))
        }
        const label = operation ? { ready: "저장 성공", rejected: "선별 제외", failed: "실패", waiting: "재시도 대기" }[operation.outcome] : "작업 건너뜀"
        console.log("[번역 큐] " + label + " " + JSON.stringify(step))
      } else {
        const reason = step.reason || "작업 대기"
        const waitingKey = reason + (step.model || "")
        if (waitingKey !== lastWaitingReason) console.log("[번역 큐] 대기 " + JSON.stringify(step))
        lastWaitingReason = waitingKey
      }
      if (process.argv.includes("--drain") && !step.processed && step.retryAfterSeconds > 30) break
      await delay(Math.min(60, Math.max(1, step.retryAfterSeconds)) * 1000, undefined, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) break
      console.error("[번역 큐] 처리 오류: " + getTranslationErrorMessage(error) + " — 60초 후 재시도")
      await delay(60_000, undefined, { signal: controller.signal }).catch(() => {})
    }
  }
  console.log(JSON.stringify(await getTranslationQueueSummary()))
}
main().catch((error) => { console.error("[번역 큐] 초기화 실패: " + getTranslationErrorMessage(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
