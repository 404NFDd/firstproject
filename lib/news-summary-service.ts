import { prisma } from "@/lib/prisma"
import { EXCLUDED_COMMUNITY_SOURCES } from "@/lib/feed-sources"
import type { Prisma } from "@prisma/client"
import { fetchArticleSummaryContent } from "@/lib/news-service"
import type { CurationResult } from "@/lib/news-curation"
import { CURATION_KIND, CURATION_CATEGORIES, isCurationArticle, getCurationHash, getCurationInput, prepareCurationRequest, prepareCurationBatchRequest, validateCurationResult, readCurationResult } from "@/lib/news-curation"

export const FREE_SUMMARY_MODEL = "gemini-3.5-flash-lite"
// 사용자가 확인한 Gemini 3.5 Flash Lite 무료 프로젝트의 실제 한도입니다.
export const FREE_SUMMARY_LIMITS = { requestsPerMinute: 15, inputTokensPerMinute: 250_000, requestsPerDay: 500 } as const
// 첨부된 무료 프로젝트 한도를 기준으로 한국어 요약 모델을 순서대로 사용합니다.
export const FREE_SUMMARY_MODELS = [
  { model: FREE_SUMMARY_MODEL, limits: FREE_SUMMARY_LIMITS },
  { model: "gemini-3.1-flash-lite", limits: FREE_SUMMARY_LIMITS },
  { model: "gemini-3.8-flash", limits: { ...FREE_SUMMARY_LIMITS, requestsPerMinute: 5, requestsPerDay: 20 } },
  { model: "gemini-3.6-flash", limits: { ...FREE_SUMMARY_LIMITS, requestsPerMinute: 5, requestsPerDay: 20 } },
] as const
const LEASE_MS = 60_000
const REQUEST_TIMEOUT_MS = 120_000
type Kind = typeof CURATION_KIND
type Status = "disabled" | "pending" | "processing" | "ready" | "failed"
export interface SummaryArticle {
  id: string; title: string; description?: string | null; content?: string | null; source: string; category?: string | null; sourceUrl?: string | null
}
export interface NewsSummaryView {
  applicable: boolean; enabled: boolean; title: string | null; preview: string | null
  status: Status; retryAfterSeconds: number; isSummary: boolean; summary: CurationResult | null
}
export interface SummaryAttempt {
  model: string
  outcome: "success" | "quota" | "unavailable" | "temporary" | "failed" | "skipped"
  reason?: string
  httpStatus?: number
  quota?: string
  retryAfterSeconds?: number
}
export interface SummaryOperation {
  kind: Kind; chunkIndex: number
  outcome: "ready" | "rejected" | "failed" | "waiting"
  model: string | null; attempts: SummaryAttempt[]
  modelSwitches: Array<{ from: string; to: string; reason: string }>
  reason?: string; retryAfterSeconds: number
}
interface SummaryStepView extends NewsSummaryView { operation?: SummaryOperation }

export function getSummaryErrorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : "알 수 없는 처리 오류"
  for (const key of [process.env.SUMMARY_GEMINI_API_KEY, process.env.TRANSLATION_GEMINI_API_KEY, process.env.GEMINI_API_KEY]) {
    if (key?.trim()) message = message.split(key.trim()).join("[키 숨김]")
  }
  return message.replace(/AIza[\w-]+/g, "[키 숨김]").replace(/\s+/g, " ").slice(0, 500)
}

export function getSummaryConfig() {
  // 기존 환경 설정과 사용량 기록을 재사용하며, 번역 작업은 실행하지 않습니다.
  const key = (process.env.SUMMARY_GEMINI_API_KEY ?? process.env.TRANSLATION_GEMINI_API_KEY)?.trim()
  const confirmed = process.env.SUMMARY_FREE_TIER_CONFIRMED ?? process.env.TRANSLATION_FREE_TIER_CONFIRMED
  if (!key || confirmed?.trim() !== "true") return null
  return { key }
}
function jobFor(article: SummaryArticle) {
  return { kind: CURATION_KIND as Kind, chunkIndex: 0, sourceHash: getCurationHash(article), ...getCurationInput(article) }
}
type Job = ReturnType<typeof jobFor>
type Row = Awaited<ReturnType<typeof prisma.newsTranslation.findMany>>[number]
function matchingRow(rows: Row[], job: Job) {
  return rows.find((row) => row.kind === CURATION_KIND && row.chunkIndex === 0 && row.sourceHash === job.sourceHash)
}
function viewFor(article: SummaryArticle, rows: Row[]): NewsSummaryView {
  const applicable = isCurationArticle(article) && !EXCLUDED_COMMUNITY_SOURCES.includes(article.source)
  const row = applicable ? matchingRow(rows, jobFor(article)) : undefined
  const summary = row?.status === "ready" ? readCurationResult(row.translatedText) : null
  const ready = Boolean(summary?.selected)
  const enabled = applicable && Boolean(getSummaryConfig())
  const status: Status = ready ? "ready" : !enabled ? "disabled" :
    row?.status === "failed" ? "failed" : row?.status === "processing" ? "processing" : "pending"
  return { applicable, enabled, isSummary: ready, summary: ready ? summary : null,
    title: ready ? summary!.title : null, preview: ready ? summary!.summary : null, status,
    retryAfterSeconds: Math.max(0, Math.ceil(((row?.retryAt?.getTime() || 0) - Date.now()) / 1000)) }
}
export async function getArticleSummary(article: SummaryArticle): Promise<NewsSummaryView> {
  if (!isCurationArticle(article) || EXCLUDED_COMMUNITY_SOURCES.includes(article.source)) return viewFor(article, [])
  return viewFor(article, await prisma.newsTranslation.findMany({ where: { newsId: article.id, kind: CURATION_KIND } }))
}
export async function getListSummaries(articles: SummaryArticle[]) {
  const eligible = articles.filter((article) => isCurationArticle(article) && !EXCLUDED_COMMUNITY_SOURCES.includes(article.source))
  const result = new Map<string, { title: string; preview: string; isSummary: boolean }>()
  if (!eligible.length) return result
  const rows = await prisma.newsTranslation.findMany({ where: {
    newsId: { in: eligible.map((article) => article.id) }, kind: CURATION_KIND, status: "ready",
  } })
  for (const article of eligible) {
    const row = rows.find((row) => row.newsId === article.id && row.sourceHash === getCurationHash(article))
    const summary = readCurationResult(row?.translatedText)
    if (summary?.selected) result.set(article.id, { title: summary.title, preview: summary.summary, isSummary: true })
  }
  return result
}
function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}
async function claim(article: SummaryArticle, job: Job) {
  const now = new Date()
  const data = { sourceHash: job.sourceHash, status: "processing", startedAt: now, retryAt: null,
    translatedTitle: null, translatedText: null }
  try {
    return await prisma.newsTranslation.create({ data: { newsId: article.id, kind: job.kind, chunkIndex: job.chunkIndex, ...data } })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const reserved = await prisma.newsTranslation.updateMany({
      where: { newsId: article.id, kind: job.kind, chunkIndex: job.chunkIndex, OR: [
        { sourceHash: { not: job.sourceHash } },
        { status: { in: ["pending", "failed"] }, OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
        { status: "processing", startedAt: { lte: new Date(now.getTime() - LEASE_MS) } },
      ] }, data,
    })
    return reserved.count ? prisma.newsTranslation.findUnique({
      where: { newsId_kind_chunkIndex: { newsId: article.id, kind: job.kind, chunkIndex: job.chunkIndex } },
    }) : null
  }
}
export function getSummaryDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
}
async function reserveRequest(intervalMs: number, model: string) {
  const dateKey = getSummaryDayKey()
  const now = new Date()
  try { await prisma.newsTranslationUsage.create({ data: { dateKey, model, nextRequestAt: now } }) }
  catch (error) { if (!isUniqueConflict(error)) throw error }
  const reserved = await prisma.newsTranslationUsage.updateMany({
    where: { dateKey, model, nextRequestAt: { lte: now },
      OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }] },
    data: { requests: { increment: 1 }, nextRequestAt: new Date(now.getTime() + intervalMs) },
  })
  if (reserved.count) return { dateKey, retryAfterSeconds: 0 }
  const usage = await prisma.newsTranslationUsage.findUniqueOrThrow({ where: { dateKey_model: { dateKey, model } } })
  return { dateKey, retryAfterSeconds: Math.max(1, Math.ceil((Math.max(usage.nextRequestAt.getTime(), usage.blockedUntil?.getTime() || 0) - now.getTime()) / 1000)) }
}
async function rememberSummaryModel(dateKey: string, model: string) {
  try { await prisma.newsTranslationUsage.create({ data: { dateKey, model: FREE_SUMMARY_MODEL, activeModel: model } }) }
  catch (error) { if (!isUniqueConflict(error)) throw error }
  await prisma.newsTranslationUsage.updateMany({ where: { dateKey, model: FREE_SUMMARY_MODEL }, data: { activeModel: model } })
}
class SummaryDeferred extends Error {
  constructor(public retryAfterSeconds: number, message = "사용 가능한 모델이 없거나 요청 간격 때문에 대기합니다.",
    public quota?: string, public httpStatus?: number) { super(message) }
}
class SummaryApiError extends Error {
  constructor(public httpStatus: number, message: string) { super(message) }
}
function prepareSummaryJob(job: Job, recentTopics: Array<{title:string;summary:string}> = []) {
  return { body: prepareCurationRequest({ title: job.title, text: job.text }, recentTopics) }
}

export function getSummaryRequestInterval(model: string = FREE_SUMMARY_MODEL) {
  const limits = FREE_SUMMARY_MODELS.find((candidate) => candidate.model === model)?.limits || FREE_SUMMARY_LIMITS
  return Math.ceil(60_000 / limits.requestsPerMinute)
}

class SummaryResponseError extends Error {}

async function requestSummary(key: string, request: { body: string }, model: string = FREE_SUMMARY_MODEL,
  onResponse?: () => Promise<void>) {
  let response: Response
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: request.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new SummaryDeferred(60, "Gemini 요청 시간 초과 (120초)")
    throw error
  }
  if (response.status === 429) {
    const header = response.headers.get("retry-after")
    const data = await response.json().catch(() => null)
    const details = Array.isArray(data?.error?.details)
      ? data.error.details as Array<{ retryDelay?: string; violations?: Array<{ quotaId?: string; quotaMetric?: string }> }> : undefined
    const daily = details?.some((detail) => Array.isArray(detail?.violations) && detail.violations.some((item) => /PerDay|per_day|requests_per_day/i.test((item.quotaId || "") + (item.quotaMetric || ""))))
    const metrics = details?.flatMap((detail) => Array.isArray(detail.violations) ? detail.violations.map((item) => (item.quotaId || "") + " " + (item.quotaMetric || "")) : []).join(" ") || ""
    const quota = daily ? "RPD" : /token/i.test(metrics) ? "TPM" : /perminute|per_minute/i.test(metrics) ? "RPM" : "종류 미확인"
    const delay = details?.find((detail) => /^\d+(?:\.\d+)?s$/.test(detail.retryDelay || ""))?.retryDelay
    const headerDelay = header ? /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000 : NaN
    const seconds = daily ? (getNextSummaryDayStart().getTime() - Date.now()) / 1000
      : Number.isFinite(headerDelay) ? headerDelay : delay ? Number(delay.slice(0, -1)) : 60
    throw new SummaryDeferred(Math.min(86400, Math.max(5, Math.ceil(seconds))),
      "Gemini 한도 도달: " + (typeof data?.error?.message === "string" ? getSummaryErrorMessage(new Error(data.error.message)) : "HTTP 429"), quota, 429)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const message = typeof data?.error?.message === "string" ? getSummaryErrorMessage(new Error(data.error.message)) : "오류 응답 내용 없음"
    if (response.status === 404) throw new SummaryDeferred(
      Math.max(5, Math.ceil((getNextSummaryDayStart().getTime() - Date.now()) / 1000)),
      "Gemini 모델 사용 불가 (HTTP 404): " + message, "모델 사용 불가", 404)
    if ([502, 503, 504].includes(response.status)) throw new SummaryDeferred(60,
      "Gemini 일시적 서버 오류 (HTTP " + response.status + "): " + message, undefined, response.status)
    throw new SummaryApiError(response.status, "Gemini HTTP " + response.status + ": " + message)
  }
  // HTTP 응답이 정상인 모델을 기억합니다. 기사별 검증 실패가 모델 선택을 되돌리지 않게 합니다.
  await onResponse?.()
  const data = await response.json()
  const candidate = data?.candidates?.[0]
  if (candidate?.finishReason !== "STOP") throw new SummaryResponseError("요약 응답 미완료: " + (candidate?.finishReason || data?.promptFeedback?.blockReason || "후보 없음"))
  const raw = candidate.content?.parts?.filter((part: { text?: string; thought?: boolean }) => typeof part.text === "string" && !part.thought)
    .map((part: { text: string }) => part.text).join("") || ""
  let result
  try { result = JSON.parse(raw) } catch { throw new SummaryResponseError("요약 응답 JSON 형식 오류") }
  return result as unknown
}

function validatedSummary(result: unknown) {
  const curated = validateCurationResult(result)
  // 이전 형식의 응답에 원문 인용이 포함되어도 저장하지 않습니다.
  return { title: curated.title, text: JSON.stringify({ ...curated, evidence: [] }), selected: curated.selected }
}

// 기사 수와 무관하게 실제 API 요청 한 번만 사용량에 집계합니다.
async function runSummaryRequest(request: { body: string }, operation: SummaryOperation, refresh: () => Promise<void>) {
  const config = getSummaryConfig()!
  const attemptedModels = new Set<string>()
  let previousModel: string | undefined
  for (let attempt = 0; attempt < FREE_SUMMARY_MODELS.length; attempt++) {
    const availability = await getSummaryAvailability()
    previousModel ??= availability.currentModel
    if (availability.retryAfterSeconds) throw new SummaryDeferred(availability.retryAfterSeconds)
    if (!availability.model || attemptedModels.has(availability.model)) throw new SummaryDeferred(1)
    const candidate = FREE_SUMMARY_MODELS.find((model) => model.model === availability.model)!
    const budget = await reserveRequest(getSummaryRequestInterval(candidate.model), candidate.model)
    if (budget.retryAfterSeconds) {
      const next = await getSummaryAvailability()
      if (next.model && next.model !== candidate.model && !next.retryAfterSeconds) continue
      throw new SummaryDeferred(Math.max(1, next.retryAfterSeconds))
    }
    if (previousModel !== candidate.model) {
      const state = availability.models.find((model) => model.model === previousModel)!
      const reason = operation.attempts.findLast((item) => item.model === previousModel)?.reason || "이전 API 한도·오류로 모델 대기 중"
      if (!attemptedModels.has(previousModel)) operation.attempts.push({ model: previousModel, outcome: "skipped",
        reason, retryAfterSeconds: state.retryAfterSeconds })
      operation.modelSwitches.push({ from: previousModel, to: candidate.model, reason })
    }
    previousModel = candidate.model
    attemptedModels.add(candidate.model)
    await refresh()
    operation.model = candidate.model
    try {
      const result = await requestSummary(config.key, request, candidate.model,
        availability.currentModel !== candidate.model ? () => rememberSummaryModel(budget.dateKey, candidate.model) : undefined)
      operation.attempts.push({ model: candidate.model, outcome: "success" })
      return result
    } catch (error) {
      operation.attempts.push({ model: candidate.model, outcome: error instanceof SummaryDeferred ? error.httpStatus === 404 ? "unavailable" : error.httpStatus === 429 ? "quota" : "temporary" : "failed",
        reason: getSummaryErrorMessage(error),
        httpStatus: error instanceof SummaryDeferred || error instanceof SummaryApiError ? error.httpStatus : undefined,
        ...(error instanceof SummaryDeferred ? { quota: error.quota, retryAfterSeconds: error.retryAfterSeconds } : {}) })
      if (!(error instanceof SummaryDeferred)) throw error
      await prisma.newsTranslationUsage.updateMany({ where: { dateKey: budget.dateKey, model: candidate.model },
        data: { blockedUntil: new Date(Date.now() + error.retryAfterSeconds * 1000) } })
    }
  }
  throw new SummaryDeferred(Math.max(1, (await getSummaryAvailability()).retryAfterSeconds))
}

// 재시도 묶음 크기만 저장하며 원문 본문은 저장하지 않습니다. 워커가 재시작돼도 작은 묶음으로 재시도합니다.
function readRetryBatchSize(text: string | null) {
  try {
    const value = JSON.parse(text || "null")?.retryBatchSize
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value as number : 10
  } catch { return 10 }
}
interface ReservedSummary {
  article: SummaryArticle; job: Job; retryBatchSize: number
  where: { id: string; sourceHash: string; status: string }
}
export function getSummaryBatchSize(inputs: Array<{ text: string; retryBatchSize?: number }>) {
  if (!inputs.length) return 0
  const length = inputs[0].text.length
  const target = length <= 3000 ? 10 : length > 20000 ? 1 : length > 10000 ? 3 : 5
  let count = 0, total = 0, retryLimit = 10
  for (const input of inputs.slice(0, target)) {
    retryLimit = Math.min(retryLimit, input.retryBatchSize ?? 10)
    if (count && (count + 1 > retryLimit || total + input.text.length > 30000)) break
    count++
    total += input.text.length
  }
  // 분량은 묶음 크기를 고를 때만 사용합니다. 긴 단일 기사도 자르거나 차단하지 않습니다.
  return count
}

async function summarizeArticlesStep(articles: SummaryArticle[]) {
  const reserved: ReservedSummary[] = []
  const completed: Array<{ newsId: string; view: SummaryStepView }> = []
  let heartbeatError: unknown
  const refresh = async () => {
    if (heartbeatError) throw heartbeatError
    for (const item of reserved) {
      const renewed = await prisma.newsTranslation.updateMany({ where: item.where, data: { startedAt: new Date() } })
      if (!renewed.count) throw new Error("작업 예약이 변경되어 요약을 계속할 수 없습니다.")
    }
  }
  const heartbeat = setInterval(() => { void refresh().catch((error: unknown) => { heartbeatError = error }) }, 20_000)
  heartbeat.unref()
  const operation: SummaryOperation = { kind: CURATION_KIND, chunkIndex: 0, outcome: "waiting", model: null,
    attempts: [], modelSwitches: [], retryAfterSeconds: 0 }
  const finishFailure = async (item: ReservedSummary, error: unknown, retryBatchSize?: number) => {
    const deferred = error instanceof SummaryDeferred
    const retryAfterSeconds = deferred ? error.retryAfterSeconds : retryBatchSize ? getSummaryRequestInterval() / 1000 : 3600
    const failedOperation: SummaryOperation = { ...operation, outcome: deferred || retryBatchSize ? "waiting" : "failed",
      reason: getSummaryErrorMessage(error), retryAfterSeconds }
    await prisma.newsTranslation.updateMany({ where: item.where, data: {
      status: deferred || retryBatchSize ? "pending" : "failed", retryAt: new Date(Date.now() + retryAfterSeconds * 1000),
      translatedText: deferred || retryBatchSize ? JSON.stringify({ retryBatchSize: retryBatchSize ?? item.retryBatchSize }) : null,
    } })
    completed.push({ newsId: item.article.id, view: { ...await getArticleSummary(item.article), retryAfterSeconds, operation: failedOperation } })
  }
  try {
    for (const article of articles) {
      if (!isCurationArticle(article) || EXCLUDED_COMMUNITY_SOURCES.includes(article.source) || !getSummaryConfig()) continue
      const rows = await prisma.newsTranslation.findMany({ where: { newsId: article.id, kind: CURATION_KIND } })
      const job = jobFor(article)
      const current = matchingRow(rows, job)
      if (current?.status === "ready" || current?.status === "rejected") continue
      const retryBatchSize = readRetryBatchSize(current?.translatedText ?? null)
      const reservation = await claim(article, job)
      if (!reservation) continue
      const item = { article, job, retryBatchSize, where: { id: reservation.id, sourceHash: job.sourceHash, status: "processing" } }
      reserved.push(item)
    }
    // 원문 조회는 AI 요청과 별개이며 서로 독립적인 기사 최대 10개만 읽습니다.
    await Promise.all(reserved.map(async (item) => {
      try {
        if (!item.job.text.trim()) item.job.text = await fetchArticleSummaryContent(item.article) || ""
        if (!item.job.text.trim()) throw new Error("한국어 요약에 필요한 원문 본문을 읽을 수 없습니다.")
      } catch (error) {
        await finishFailure(item, error)
        reserved.splice(reserved.indexOf(item), 1)
      }
    }))
    const size = getSummaryBatchSize(reserved.map((item) => ({ text: item.job.text, retryBatchSize: item.retryBatchSize })))
    const remaining = reserved.splice(size)
    for (const item of remaining) await prisma.newsTranslation.updateMany({ where: item.where, data: {
      status: "pending", startedAt: null, translatedText: JSON.stringify({ retryBatchSize: item.retryBatchSize }),
    } })
    if (!reserved.length) return completed
    const recent = await prisma.newsTranslation.findMany({
      where: { kind: CURATION_KIND, status: "ready", newsId: { notIn: reserved.map((item) => item.article.id) },
        news: { publishedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } } },
      orderBy: { createdAt: "desc" }, take: 20,
    })
    const recentTopics = recent.map((row) => readCurationResult(row.translatedText)).filter((result) => result?.selected)
      .map((result) => ({ title: result!.title, summary: result!.summary.slice(0, 200) }))
    const isBatch = reserved.length > 1
    const request = !isBatch ? prepareSummaryJob(reserved[0].job, recentTopics) : {
      body: prepareCurationBatchRequest(reserved.map((item) => ({ id: item.article.id, title: item.job.title, text: item.job.text })), recentTopics),
    }
    const response = await runSummaryRequest(request, operation, refresh)
    const results = new Map<string, unknown>()
    if (!isBatch) results.set(reserved[0].article.id, response)
    else {
      const values = response && typeof response === "object" && "results" in response ? response.results : null
      if (!Array.isArray(values)) throw new SummaryResponseError("기사별 요약 결과 배열이 없습니다.")
      const ids = new Set(reserved.map((item) => item.article.id))
      for (const result of values) {
        if (!result || typeof result.id !== "string" || !ids.has(result.id) || results.has(result.id)) {
          throw new SummaryResponseError("요약 응답의 기사 ID가 중복되었거나 입력과 다릅니다.")
        }
        results.set(result.id, result)
      }
    }
    await refresh()
    // 기사별 응답 구조를 확인하고 성공한 기사부터 저장합니다.
    for (const item of [...reserved]) {
      try {
        if (!results.has(item.article.id)) throw new Error("요약 응답에서 기사 결과가 누락됐습니다.")
        const result = validatedSummary(results.get(item.article.id))
        const outcome = result.selected ? "ready" : "rejected"
        const saved = await prisma.newsTranslation.updateMany({ where: item.where, data: {
          status: outcome, translatedTitle: result.title, translatedText: result.text, retryAt: null,
        } })
        if (!saved.count) throw new Error("작업 예약이 변경되어 요약 결과를 저장하지 못했습니다.")
        completed.push({ newsId: item.article.id, view: { ...await getArticleSummary(item.article), retryAfterSeconds: 0,
          operation: { ...operation, outcome } } })
      } catch (error) { await finishFailure(item, error, isBatch ? 1 : undefined) }
      reserved.splice(reserved.indexOf(item), 1)
    }
  } catch (error) {
    const split = reserved.length > 1 && (error instanceof SummaryResponseError ||
      error instanceof SummaryApiError && (error.httpStatus === 413 || error.httpStatus === 400 && /token|context|input.*(?:size|long)|payload/i.test(error.message)))
    const retrySize = split ? Math.max(1, Math.floor(reserved.length / 2)) : undefined
    for (const item of reserved) await finishFailure(item, error, retrySize)
  } finally { clearInterval(heartbeat) }
  return completed
}

export async function summarizeArticleStep(article: SummaryArticle): Promise<SummaryStepView> {
  const results = await summarizeArticlesStep([article])
  return results[0]?.view ?? getArticleSummary(article)
}

// 짧은 영어 원문을 바로 한국어로 요약해 대체 모델을 확인합니다. 기사 큐는 수정하지 않으며 요청 예산은 집계합니다.
export async function checkSummaryModels() {
  const config = getSummaryConfig()
  if (!config) throw new Error("무료 요약 프로젝트 설정을 확인하세요.")
  const job: Job = { kind: CURATION_KIND, chunkIndex: 0, sourceHash: "model-check", title: "Compiler caching release",
    text: "A compiler release adds build caching. Compatibility depends on the project. Developers can enable caching after checking compatibility." }
  const request = prepareSummaryJob(job)
  const results: Array<SummaryAttempt & { summary?: string }> = []
  for (const candidate of FREE_SUMMARY_MODELS.slice(1)) {
    const budget = await reserveRequest(getSummaryRequestInterval(candidate.model), candidate.model)
    if (budget.retryAfterSeconds) {
      results.push({ model: candidate.model, outcome: "skipped", reason: "앱 기록상 요청 간격 또는 한도 대기 중", retryAfterSeconds: budget.retryAfterSeconds })
      continue
    }
    try {
      const result = validatedSummary(await requestSummary(config.key, request, candidate.model))
      results.push({ model: candidate.model, outcome: "success", summary: readCurationResult(result.text)?.summary })
    } catch (error) {
      results.push({ model: candidate.model, outcome: error instanceof SummaryDeferred ? error.httpStatus === 404 ? "unavailable" : error.httpStatus === 429 ? "quota" : "temporary" : "failed",
        reason: getSummaryErrorMessage(error), httpStatus: error instanceof SummaryDeferred || error instanceof SummaryApiError ? error.httpStatus : undefined,
        ...(error instanceof SummaryDeferred ? { quota: error.quota, retryAfterSeconds: error.retryAfterSeconds } : {}) })
      if (error instanceof SummaryDeferred) await prisma.newsTranslationUsage.updateMany({ where: { dateKey: budget.dateKey, model: candidate.model },
        data: { blockedUntil: new Date(Date.now() + error.retryAfterSeconds * 1000) } })
    }
  }
  return results
}


// 이 조건은 목록의 기사 조회와 페이지 수 집계에 함께 사용합니다.
export const PUBLISHED_SUMMARY_FILTER: Prisma.NewsWhereInput = {
  AND: [{ translations: { some: { kind: CURATION_KIND, status: "ready" } } }],
}

export async function enqueueArticleSummary(article: SummaryArticle) {
  if (typeof article.id !== "string" || !article.id.trim()) throw new Error("요약 큐 등록에는 기사 ID가 필요합니다.")
  if (!isCurationArticle(article) || EXCLUDED_COMMUNITY_SOURCES.includes(article.source)) {
    await prisma.newsTranslation.deleteMany({ where: { newsId: article.id } })
    return { applicable: false, jobs: 0, added: 0 }
  }
  await prisma.newsTranslation.deleteMany({ where: { newsId: article.id, kind: { not: CURATION_KIND }, status: { not: "ready" } } })
  const job = jobFor(article)
  const data = { newsId: article.id, kind: CURATION_KIND, chunkIndex: 0, sourceHash: job.sourceHash,
    status: "pending", startedAt: null, retryAt: null, translatedTitle: null, translatedText: null }
  let added = 0
  for (let attempt = 0; ; attempt++) {
    try {
      const created = await prisma.newsTranslation.createMany({ data: [data], skipDuplicates: true })
      added += created.count
      await prisma.newsTranslation.updateMany({ where: { newsId: article.id, kind: CURATION_KIND, chunkIndex: 0,
        sourceHash: { not: job.sourceHash } }, data })
      return { applicable: true, jobs: 1, added }
    } catch (error) {
      if (attempt >= 2 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error
      // 큐 등록의 일시적인 DB 충돌만 재시도하며 AI 요청을 보내지 않습니다.
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 50))
    }
  }
}

export async function enqueueExistingNews() {
  let cursor: string | undefined
  const totals = { checked: 0, eligible: 0, addedJobs: 0 }
  while (true) {
    const articles = await prisma.news.findMany({
      where: { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, category: { in: CURATION_CATEGORIES } },
      orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, sourceUrl: true, source: true, category: true },
    })
    for (const article of articles) {
      const result = await enqueueArticleSummary(article)
      totals.checked++
      if (result.applicable) totals.eligible++
      totals.addedJobs += result.added
    }
    if (articles.length < 100) return totals
    cursor = articles[articles.length - 1].id
  }
}

// 미국 태평양 자정은 UTC의 정시에 해당합니다. 날짜 전환은 Intl로 계산해 서머타임을 반영합니다.
export function getNextSummaryDayStart(now = new Date()) {
  const currentDay = getSummaryDayKey(now)
  const hour = 3_600_000
  let timestamp = Math.ceil(now.getTime() / hour) * hour
  for (let index = 0; index < 27; index++, timestamp += hour) {
    const candidate = new Date(timestamp)
    if (getSummaryDayKey(candidate) !== currentDay) return candidate
  }
  throw new Error("요약 한도 갱신 시각을 계산하지 못했습니다.")
}

export async function getSummaryAvailability() {
  const now = new Date()
  const dateKey = getSummaryDayKey(now)
  const models = await Promise.all(FREE_SUMMARY_MODELS.map(async (candidate) => {
    const usage = await prisma.newsTranslationUsage.findUnique({ where: { dateKey_model: { dateKey, model: candidate.model } } })
    const quotaAt = Math.max(now.getTime(), usage?.blockedUntil?.getTime() || 0)
    const nextAt = Math.max(quotaAt, usage?.nextRequestAt.getTime() || 0)
    const quotaStatus = quotaAt > now.getTime() ? "api_wait" : nextAt > now.getTime() ? "interval" : "available"
    return { model: candidate.model, requests: usage?.requests || 0, freeTierLimits: candidate.limits,
      activeModel: usage?.activeModel || null, quotaStatus, quotaAvailable: quotaAt <= now.getTime(), retryAfterSeconds: Math.max(0, Math.ceil((nextAt - now.getTime()) / 1000)) }
  }))
  const remembered = models.find((candidate) => candidate.model === FREE_SUMMARY_MODEL)?.activeModel
  const rememberedIndex = models.findIndex((candidate) => candidate.model === remembered)
  const currentIndex = Math.max(0, rememberedIndex)
  const currentModel = models[currentIndex].model
  // 기억한 모델부터 시작하고, 한도·오류 대기 때만 다음 모델을 선택합니다. 정상 요청 간격은 기다립니다.
  const ordered = [...models.slice(currentIndex), ...models.slice(0, currentIndex)]
  const available = ordered.find((candidate) => candidate.quotaAvailable)
  return { dateKey, requests: models.reduce((sum, candidate) => sum + candidate.requests, 0),
    currentModel, model: available?.model || null, models,
    retryAfterSeconds: available?.retryAfterSeconds ?? Math.min(...models.map((candidate) => candidate.retryAfterSeconds)) }
}

export async function processSummaryQueueStep() {
  const config = getSummaryConfig()
  if (!config) return { enabled: false, processed: false, reason: "무료 요약 설정 꺼짐", retryAfterSeconds: 60 }
  const available = await getSummaryAvailability()
  if (available.retryAfterSeconds) return { enabled: true, processed: false, model: available.model,
    reason: available.model ? "요청 간격 대기" : "모든 모델이 한도·API 오류로 대기 중", models: available.models, retryAfterSeconds: available.retryAfterSeconds }
  const now = new Date()
  const candidates = await prisma.newsTranslation.findMany({
    where: {
      kind: CURATION_KIND,
      news: { source: { notIn: [...EXCLUDED_COMMUNITY_SOURCES] }, category: { in: CURATION_CATEGORIES } },
      OR: [
        { status: { in: ["pending", "failed"] }, OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
        { status: "processing", startedAt: { lte: new Date(now.getTime() - LEASE_MS) } },
      ],
    },
    orderBy: [{ news: { publishedAt: "desc" } }, { newsId: "desc" }, { kind: "desc" }, { chunkIndex: "asc" }],
    include: { news: true }, take: 10,
  })
  if (!candidates.length) return { enabled: true, processed: false, reason: "지금 처리 가능한 작업 없음 (완료 또는 기사별 재시도 대기)", retryAfterSeconds: 60 }
  const results = await summarizeArticlesStep(candidates.map((candidate) => candidate.news))
  const nextRequest = await getSummaryAvailability()
  const operations = results.map(({ newsId, view }) => ({ newsId, operation: view.operation, status: view.status }))
  return {
    enabled: true, processed: Boolean(results.length), retryAfterSeconds: Math.max(1, nextRequest.retryAfterSeconds),
    newsId: operations[0]?.newsId, operation: operations[0]?.operation, status: operations[0]?.status, operations,
  }
}

export async function getSummaryQueueSummary() {
  const rows = await prisma.newsTranslation.findMany({ where: { kind: CURATION_KIND }, select: { newsId: true, kind: true, status: true } })
  const all = new Set(rows.map((row) => row.newsId))
  const unfinished = new Set(rows.filter((row) => !["ready", "rejected"].includes(row.status)).map((row) => row.newsId))
  const rejected = new Set(rows.filter((row) => row.kind === CURATION_KIND && row.status === "rejected").map((row) => row.newsId))
  const config = getSummaryConfig()
  const availability = await getSummaryAvailability()
  return {
    enabled: Boolean(config), totalArticles: all.size, completedArticles: all.size - unfinished.size - rejected.size,
    rejectedArticles: rejected.size, selectedArticles: rows.filter((row) => row.kind === CURATION_KIND && row.status === "ready").length,
    pendingArticles: unfinished.size, totalJobs: rows.length, readyJobs: rows.filter((row) => row.status === "ready").length,
    failedJobs: rows.filter((row) => row.status === "failed").length,
    requestsPerMinute: FREE_SUMMARY_LIMITS.requestsPerMinute, inputTokensPerMinute: FREE_SUMMARY_LIMITS.inputTokensPerMinute,
    freeTierLimits: FREE_SUMMARY_LIMITS, ...availability,
  }
}
