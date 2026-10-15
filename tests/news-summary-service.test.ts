import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { prisma } from "../lib/prisma"
import {
  FREE_SUMMARY_MODEL, FREE_SUMMARY_MODELS, getSummaryAvailability, getSummaryQueueSummary,
  checkSummaryModels, getSummaryErrorMessage,
  getArticleSummary, getListSummaries, getSummaryConfig,
  summarizeArticleStep, enqueueArticleSummary, enqueueExistingNews,
  processSummaryQueueStep, getNextSummaryDayStart, getSummaryRequestInterval, getSummaryBatchSize,
} from "../lib/news-summary-service"
import { CURATION_KIND, getCurationHash } from "../lib/news-curation"

type Data = Record<string, unknown>
const original = { news: prisma.news, translation: prisma.newsTranslation, usage: prisma.newsTranslationUsage }
const envNames = ["SUMMARY_GEMINI_API_KEY", "SUMMARY_FREE_TIER_CONFIRMED", "SUMMARY_DAILY_REQUEST_LIMIT", "GEMINI_API_KEY", "GEMINI_MODEL"] as const
let oldEnv: Map<string, string | undefined>
let rows: Data[]
let usage: Data[]
let articles: Map<string, typeof article & {publishedAt?:Date}>
type RequestInput = { title: string; text: string; articles?: Array<{ id: string; title: string; text: string }> }
let requests: Array<{ url: string; input: RequestInput }>
const article = { id: "summary-test", category: "developer", source: "JetBrains IntelliJ IDEA", title: "Faster builds in Node.js 24.0",
  description: "The compiler is now faster.", content: "The compiler is faster with Node.js 24.0.\n\nRun the command below.\n\nnpm install example@2.0\n\nThe final paragraph describes compatibility." }
const conflict = () => Object.assign(new Error("고유 예약 충돌"), { code: "P2002" })

function matches(row: Data = {}, where: Data = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Data[]).some((condition) => matches(row, condition))
    if (key === "dateKey_model") return matches(row, expected as Data)
    if (key === "news") return matches(articles.get(String(row.newsId)) as unknown as Data, expected as Data)
    const value = key === "model" ? row.model || FREE_SUMMARY_MODEL : row[key]
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const conditions = expected as Data
      return Object.entries(conditions).every(([operator, limit]) => {
        if (operator === "not") return value !== limit
        if (operator === "in") return (limit as unknown[]).includes(value)
        if (operator === "notIn") return !(limit as unknown[]).includes(value)
        if (operator === "gte") return Number(value) >= Number(limit)
        if (operator === "lt" || operator === "lte") {
          if (value === null || value === undefined) return false
          return operator === "lt" ? Number(value) < Number(limit) : Number(value) <= Number(limit)
        }
        return false
      })
    }
    return value === expected
  })
}
function update(target: Data[], where: Data, data: Data) {
  let count = 0
  for (const row of target.filter((entry) => matches(entry, where))) {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value
        ? Number(row[key]) + Number(value.increment) : value
    }
    count++
  }
  return { count }
}
async function successfulResponse(input: { title: string; text: string; articles?: Array<{ id: string; title: string; text: string }> }) {
  if (!input.articles) return curationResponse(true, input)
  const results = await Promise.all(input.articles.map(async (article) => {
    const response = await curationResponse(true, article).json()
    return { id: article.id, ...JSON.parse(response.candidates[0].content.parts[0].text) }
  }))
  return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ results }) }] } }] }))
}
function curationResponse(selected: boolean, input: {title:string;text:string}, summary = "컴파일러가 개선됐습니다. 호환성 변화와 빌드 과정을 함께 살펴볼 만한 소식입니다.") {
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({
    selected,title:selected?"컴파일러의 빌드 과정 개선":"",summary:selected?summary:"",
    highlights:selected?["**컴파일러**의 빌드 과정이 개선됐습니다.","호환성을 확인해야 합니다.","프로젝트 환경에서 적용 범위를 검토할 수 있습니다."]:[],
    sections:selected?[{heading:"적용 범위와 호환성",bullets:[{text:"빌드 과정과 호환성 변화를 함께 살펴봐야 합니다.",details:["실제 프로젝트 환경을 확인합니다."]}],table:null}]:[],
    reason:selected?"개발 실무의 변화":"단순 홍보",evidence:selected?[input.text.split("\n\n")[0]]:[],
  })}]} }]}))
}
beforeEach(() => {
  oldEnv = new Map(envNames.map((name) => [name, process.env[name]]))
  process.env.SUMMARY_GEMINI_API_KEY = "fake-key-only-for-mock"
  process.env.SUMMARY_FREE_TIER_CONFIRMED = "true"
  process.env.SUMMARY_DAILY_REQUEST_LIMIT = ""
  rows = []; usage = []; requests = []; articles = new Map([[article.id,article]])
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-02T01:00:00Z") })
  Object.defineProperty(prisma, "news", { configurable: true, value: {
    findMany: async () => [...articles.values()], findUnique: async () => article,
  } })
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, value: {
    findMany: async ({ where, include, take }: { where: Data; include?: { news: boolean }; take?: number }) => {
      const values = rows.filter((row) => matches(row, where))
      if (include?.news) values.sort((a,b) => {
        const date = (id: unknown) => articles.get(String(id))?.publishedAt?.getTime() || 0
        return date(b.newsId) - date(a.newsId) || String(b.newsId).localeCompare(String(a.newsId))
      })
      return values.slice(0, take ?? values.length).map((row) => include?.news ? { ...row, news: articles.get(String(row.newsId)) } : row)
    },
    createMany: async ({data}: {data:Data[]}) => {
      let count=0
      for (const value of data) {
        if (rows.some((row)=>row.newsId===value.newsId && row.kind===value.kind && row.chunkIndex===value.chunkIndex)) continue
        rows.push({id:"row-"+rows.length,...value});count++
      }
      return {count}
    },
    deleteMany: async ({where}: {where:Data}) => {
      const previous=rows.length;rows=rows.filter((row)=>!matches(row,where));return {count:previous-rows.length}
    },
    findFirst: async ({where}: {where:Data}) => {
      const candidates=rows.filter((row)=>matches(row,where)).sort((a,b)=>{
        const date=(id:unknown)=>articles.get(String(id))?.publishedAt?.getTime()||0
        return date(b.newsId)-date(a.newsId) || String(b.newsId).localeCompare(String(a.newsId)) ||
          String(b.kind).localeCompare(String(a.kind)) || Number(a.chunkIndex)-Number(b.chunkIndex)
      })
      const value=candidates[0]
      return value?{...value,news:articles.get(String(value.newsId))}:null
    },
    create: async ({ data }: { data: Data }) => {
      if (rows.some((row) => row.newsId === data.newsId && row.kind === data.kind && row.chunkIndex === data.chunkIndex)) throw conflict()
      const row = { id: "row-" + rows.length, translatedTitle: null, translatedText: null, startedAt: null, retryAt: null, ...data }
      rows.push(row); return row
    },
    updateMany: async ({ where, data }: { where: Data; data: Data }) => update(rows, where, data),
    findUnique: async ({ where }: { where: { newsId_kind_chunkIndex: Data } }) => rows.find((row) => matches(row, where.newsId_kind_chunkIndex)),
  } })
  Object.defineProperty(prisma, "newsTranslationUsage", { configurable: true, value: {
    create: async ({ data }: { data: Data }) => {
      if (usage.some((row) => row.dateKey === data.dateKey && (row.model || FREE_SUMMARY_MODEL) === data.model)) throw conflict()
      const row = { requests: 0, nextRequestAt: new Date(), blockedUntil: null, ...data }
      usage.push(row); return row
    },
    updateMany: async ({ where, data }: { where: Data; data: Data }) => update(usage, where, data),
    findUnique: async ({where}: {where:Data}) => usage.find((row)=>matches(row,where))||null,
    findUniqueOrThrow: async ({ where }: { where: Data }) => usage.find((row) => matches(row, where))!,
  } })
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    const originalInput = JSON.parse(body.contents[0].parts[0].text)
    requests.push({ url: String(input), input: originalInput })
    return successfulResponse(originalInput)
  })
})
afterEach(() => {
  mock.restoreAll(); mock.timers.reset()
  Object.defineProperty(prisma, "news", { configurable: true, value: original.news })
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, value: original.translation })
  Object.defineProperty(prisma, "newsTranslationUsage", { configurable: true, value: original.usage })
  for (const [name, value] of oldEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("영문 기사는 원문에서 바로 한국어 요약·정리 하나로 완료한다", async () => {
  const tech={...article,category:"developer"}
  articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input}); return successfulResponse(input)
  })
  await enqueueArticleSummary(tech)
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND])
  assert.equal((await getListSummaries([tech])).size,0)
  await processSummaryQueueStep()
  assert.equal(rows[0].status,"ready")
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND])
  const summary=(await getListSummaries([tech])).get(tech.id)!
  assert.equal(summary.isSummary,true)
  assert.match(summary.preview,/호환성/)
  assert.equal((await getArticleSummary(tech)).status,"ready")
  assert.equal((await getArticleSummary(tech)).summary?.sections[0].heading,"적용 범위와 호환성")
  assert.deepEqual(JSON.parse(String(rows[0].translatedText)).evidence,[])
  assert.equal((await getArticleSummary(tech)).isSummary,true)
  assert.equal(usage[0].requests,1)
})

test("한국어 기사도 같은 요약 요청 하나로 처리한다",async()=>{
  const tech={...article,category:"105",title:"컴파일러 변화",content:"컴파일러에서 빌드 과정을 개선했습니다. 적용할 때는 프로젝트의 호환성을 확인해야 합니다."}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return successfulResponse(input)
  })
  await enqueueArticleSummary(tech)
  await summarizeArticleStep(tech)
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND])
  assert.equal((await getListSummaries([tech])).get(tech.id)?.isSummary,true)
  assert.equal(requests.length,1)
})

test("영문 원문을 번역하지 않고 한국어 요약 프롬프트에 그대로 전달한다", async () => {
  let prompt = ""
  mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body))
    prompt = request.systemInstruction.parts[0].text
    const input = JSON.parse(request.contents[0].parts[0].text)
    assert.equal(input.text, article.content)
    requests.push({url:"summary",input})
    return successfulResponse(input)
  })
  const result = await summarizeArticleStep(article)
  assert.equal(result.status,"ready")
  assert.match(prompt,/반드시 자연스러운 한국어/)
  assert.doesNotMatch(prompt,/정확하게 번역하세요|내용을 생략하지|__NH_/)
  assert.equal(requests.length,1)
  assert.deepEqual(rows.map((row)=>row.kind),[CURATION_KIND])
  assert.match(result.summary!.title,/[가-힣]/)
})

test("긴 원문도 마지막 문단까지 요약 입력으로 읽고 기사별 작업 하나만 생성한다",async()=>{
  const articleEnd="The last paragraph explains the compatibility limits."
  const large={...article,content:"A paragraph explains build caching.\n\n".repeat(500)+articleEnd}
  const result=await summarizeArticleStep(large)
  assert.equal(result.status,"ready")
  assert.equal(rows.length,1)
  assert.equal(requests.length,1)
  assert.ok(requests[0].input.text.endsWith(articleEnd))
  assert.doesNotMatch(String(rows[0].translatedText),/A paragraph explains build caching/)
})

test("미분류 기사에는 전문 번역 경로를 만들지 않는다",async()=>{
  const unsupported={...article,category:undefined}
  assert.equal((await enqueueArticleSummary(unsupported)).applicable,false)
  assert.equal((await summarizeArticleStep(unsupported)).applicable,false)
  assert.equal(rows.length,0)
  assert.equal(requests.length,0)
})

test("기존 기사 큐 등록은 원문 언어와 무관하게 요약 대상만 등록한다",async()=>{
  const korean={...article,id:"korean",content:"한국어 원문입니다."}
  const excluded={...article,id:"excluded",source:"GeekNews"}
  articles=new Map([[article.id,article],[korean.id,korean],[excluded.id,excluded]])
  const result=await enqueueExistingNews()
  assert.equal(result.eligible,2)
  assert.equal(rows.length,2)
  assert.equal(rows.every((row)=>row.kind===CURATION_KIND),true)
  assert.equal(requests.length,0)
})

test("원문 없이 등록한 기사도 요약할 때만 피드 본문을 읽고 한국어 정리 한 건을 저장한다", async () => {
  const tech = { ...article, category: "infrastructure", source: "Cloudflare Blog", sourceUrl: "https://blog.cloudflare.com/test-summary/", description: null, content: null }
  articles.set(tech.id, tech as never)
  let sourceReads = 0
  mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url) === "https://blog.cloudflare.com/rss/") {
      sourceReads++
      return new Response(`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Cloudflare</title><item><title>Compiler update</title><link>${tech.sourceUrl}</link><pubDate>Wed, 30 Sep 2026 15:30:00 GMT</pubDate><content:encoded><![CDATA[<p>The compiler is faster. Compatibility depends on the project.</p><a href="/docs/">Docs</a>]]></content:encoded></item></channel></rss>`)
    }
    const input = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({ url: String(url), input })
    assert.match(input.text, /https:\/\/blog.cloudflare.com\/docs\//)
    return curationResponse(true, input)
  })
  await enqueueArticleSummary(tech)
  assert.equal(sourceReads, 0)
  assert.equal(rows.length, 1)
  await processSummaryQueueStep()
  assert.equal(sourceReads, 1)
  assert.equal(requests.length, 1)
  const saved = String(rows[0].translatedText)
  assert.doesNotMatch(saved, /The compiler is faster/)
  assert.equal(rows[0].status, "ready")
  assert.equal((await getArticleSummary(tech)).summary?.highlights.length, 3)
  await enqueueArticleSummary(tech)
  await processSummaryQueueStep()
  assert.equal(sourceReads, 1)
  assert.equal(tech.content, null)
})

test("원문을 읽을 수 없는 요약 작업은 AI를 호출하지 않고 실패와 재시도 대기를 남긴다", async () => {
  const tech = { ...article, category: "infrastructure", source: "Cloudflare Blog", sourceUrl: "https://blog.cloudflare.com/missing/", content: null }
  articles.set(tech.id, tech as never)
  mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }))
  await enqueueArticleSummary(tech)
  const step = await processSummaryQueueStep()
  assert.equal(step.operation?.outcome, "failed")
  assert.equal(step.operation?.attempts.length, 0)
  assert.equal(usage.length, 0)
  assert.equal((await getArticleSummary(tech)).summary, null)
})

test("이전 전문 번역 대기는 제거하고 새 한국어 요약만 처리한다", async () => {
  const tech = { ...article, category: "developer" }; articles.set(tech.id, tech)
  rows.push({ id: "old-pending", newsId: tech.id, kind: "content", status: "pending", chunkIndex: 0 },
    { id: "old-ready", newsId: tech.id, kind: "curation-v1", status: "ready", chunkIndex: 0 })
  await enqueueArticleSummary(tech)
  assert.equal(rows.some((row) => row.kind === "content"), false)
  assert.equal(rows.filter((row) => row.status === "pending").length, 1)
  assert.equal((await getArticleSummary(tech)).summary, null)
})

test("제외 결정은 재등록·워커 실행으로 재요청하지 않고 목록에도 나타나지 않는다",async()=>{
  const tech={...article,category:"engineering"};articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return curationResponse(false,input)
  })
  await enqueueArticleSummary(tech);await processSummaryQueueStep()
  assert.equal(rows[0].status,"rejected")
  await enqueueArticleSummary(tech);await processSummaryQueueStep()
  assert.equal(requests.length,1)
  assert.equal((await getListSummaries([tech])).size,0)
  assert.equal(rows.length,1)
})

test("생성된 요약은 수치 대조 없이 저장하고 목록에 게시한다",async()=>{
  const tech={...article,category:"ai"}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    return curationResponse(true,input,"빌드 속도가 999% 개선됐습니다.")
  })
  await enqueueArticleSummary(tech);await summarizeArticleStep(tech)
  assert.equal(rows[0].status,"ready")
  assert.equal((await getListSummaries([tech])).size,1)
  assert.equal(rows.length,1)
})

test("선별한 기사의 본문이 변경되면 새 선별이 끝날 때까지 요약을 숨긴다",async()=>{
  const tech={...article,category:"release"}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    return successfulResponse(input)
  })
  await enqueueArticleSummary(tech);await summarizeArticleStep(tech)
  const changed={...tech,content:tech.content+"\n\nA changed final finding."}
  await enqueueArticleSummary(changed)
  assert.equal(rows.find(r=>r.kind===CURATION_KIND)?.status,"pending")
  assert.equal(rows.find(r=>r.kind===CURATION_KIND)?.sourceHash,getCurationHash(changed))
  assert.equal((await getListSummaries([changed])).size,0)
})

test("빈 요약 키는 기존 Gemini 키가 있어도 외부 요청을 하지 않는다", async () => {
  process.env.SUMMARY_GEMINI_API_KEY = ""
  process.env.GEMINI_API_KEY = "existing-key-must-not-be-used"
  assert.equal(getSummaryConfig(), null)
  assert.equal((await summarizeArticleStep(article)).enabled, false)
  await enqueueArticleSummary(article)
  assert.equal(requests.length, 0)
  assert.equal(usage.length, 0)
})
test("무료 프로젝트 확인만 검사하며 과거 자체 한도 설정은 사용하지 않는다", async () => {
  for (const confirmation of ["", "false", "TRUE"]) {
    process.env.SUMMARY_FREE_TIER_CONFIRMED = confirmation
    assert.equal(getSummaryConfig(), null)
  }
  process.env.SUMMARY_FREE_TIER_CONFIRMED = "true"
  for (const limit of ["0", "-1", "501", "NaN", "1.5"]) {
    process.env.SUMMARY_DAILY_REQUEST_LIMIT = limit
    assert.ok(getSummaryConfig())
  }
  assert.equal(requests.length, 0)
})

test("동시에 같은 제목 요약을 요청해도 API는 한 번만 호출한다", async () => {
  await Promise.all(Array.from({ length: 5 }, () => summarizeArticleStep(article)))
  assert.equal(requests.length, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, "ready")
  assert.equal(usage[0].requests, 1)
  process.env.GEMINI_MODEL = "a-paid-model-must-not-be-used"
  await summarizeArticleStep(article)
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, new RegExp(FREE_SUMMARY_MODEL))
})
test("저장한 제목 요약은 키를 비워도 재사용하고 원문 변경 시 숨긴다", async () => {
  await summarizeArticleStep(article)
  process.env.SUMMARY_GEMINI_API_KEY = ""
  const translated = await getListSummaries([article])
  assert.match(translated.get(article.id)!.title, /컴파일러/)
  assert.equal((await getListSummaries([{ ...article, title: "Changed original" }])).size, 0)
  assert.equal(requests.length, 1)
  assert.equal(article.title, "Faster builds in Node.js 24.0")
})
test("잘린 응답은 요약 완료로 저장하지 않는다", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] })))
  assert.equal((await summarizeArticleStep(article)).status, "failed")
  assert.equal(rows[0].translatedTitle, null)
})

test("필수 JSON 필드가 없는 응답은 완료로 저장하지 않는다", async () => {
  const value = { ...article, title: "New feature", description: "An English article", content: "An English body" }
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({title:value.title,text:value.description}) }] } }] })))
  assert.equal((await summarizeArticleStep(value)).status, "failed")
  assert.equal(rows[0].translatedTitle, null)
})
test("서로 다른 기사도 공통 요청 간격으로 API 동시 호출을 제한한다", async () => {
  await Promise.all(Array.from({length:4},(_,i)=>summarizeArticleStep({...article,id:"other-"+i})))
  assert.equal(requests.length,1)
  assert.equal(usage[0].requests,1)
  assert.equal(rows.filter((row)=>row.status==="pending").length,3)
})

test("키가 비어 있어도 큐를 저장하며 중복 등록으로 완료 캐시를 지우지 않는다", async () => {
  const tech={...article,category:"developer"};articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return successfulResponse(input)
  })
  process.env.SUMMARY_GEMINI_API_KEY = ""
  const first = await enqueueArticleSummary(tech)
  const second = await enqueueArticleSummary(tech)
  assert.equal(first.added,1)
  assert.equal(second.added,0)
  assert.equal(rows.length,1)
  assert.equal(requests.length,0)
  process.env.SUMMARY_GEMINI_API_KEY = "fake-key-only-for-mock"
  await processSummaryQueueStep(); mock.timers.tick(11000)
  await processSummaryQueueStep()
  const completed = rows.map((row)=>row.translatedText)
  await enqueueArticleSummary(tech)
  assert.deepEqual(rows.map((row)=>row.translatedText),completed)
  assert.equal(rows.every((row)=>row.status==="ready"),true)
  assert.equal(requests.length,1)
})

test("큐 워커는 최신 기사부터 묶고 과거 자체 일일 제한을 적용하지 않는다", async () => {
  const older={...article,id:"older",publishedAt:new Date("2026-09-01")}
  const newer={...article,id:"newer",publishedAt:new Date("2026-10-01")}
  articles.set(older.id,older);articles.set(newer.id,newer)
  await enqueueArticleSummary(older);await enqueueArticleSummary(newer)
  process.env.SUMMARY_DAILY_REQUEST_LIMIT="1"
  usage.push({model:FREE_SUMMARY_MODEL,dateKey:"2026-10-01",requests:500,nextRequestAt:new Date(),blockedUntil:null})
  const first=await processSummaryQueueStep()
  assert.equal(first.newsId,"newer")
  assert.equal(first.operations?.length,2)
  assert.equal(requests.length,1)
  assert.equal(rows.filter(row=>row.status==="ready").length,2)
  assert.equal(usage[0].requests,501)
})

test("큐 워커의 동시 실행과 중단된 예약은 API를 중복 호출하지 않는다", async () => {
  const tech={...article,category:"developer"};articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return successfulResponse(input)
  })
  await enqueueArticleSummary(tech)
  await Promise.all([processSummaryQueueStep(),processSummaryQueueStep(),processSummaryQueueStep()])
  assert.equal(requests.length,1)
  mock.timers.tick(11000)
  const body=rows.find((row)=>row.kind===CURATION_KIND)!
  body.status="processing";body.startedAt=new Date(Date.now()-61000)
  await processSummaryQueueStep()
  assert.equal(body.status,"ready")
  assert.equal(requests.length,2)
})

test("미국 태평양 날짜의 한도 갱신 시각은 서머타임을 반영한다", () => {
  assert.equal(getNextSummaryDayStart(new Date("2026-10-02T05:30:00Z")).toISOString(),"2026-10-02T07:00:00.000Z")
  assert.equal(getNextSummaryDayStart(new Date("2026-12-02T05:30:00Z")).toISOString(),"2026-12-02T08:00:00.000Z")
})

test("기사 ID가 없는 큐 등록은 DB 변경 전에 거절한다", async () => {
  await enqueueArticleSummary(article)
  const before=rows.length
  await assert.rejects(()=>enqueueArticleSummary({...article,id:"",content:"한국어 기사"}),/기사 ID/)
  assert.equal(rows.length,before)
  assert.equal(requests.length,0)
})

test("큐 등록의 일시적인 MySQL 쓰기 충돌은 API 없이 재시도한다", async () => {
  const insert = prisma.newsTranslation.createMany.bind(prisma.newsTranslation)
  let attempts=0
  mock.method(prisma.newsTranslation,"createMany",async (args: Parameters<typeof insert>[0])=>{
    attempts++
    if(attempts===1) throw Object.assign(new Error("쓰기 충돌"),{code:"P2034"})
    return insert(args)
  })
  assert.equal((await enqueueArticleSummary(article)).added,1)
  assert.equal(attempts,2)
  assert.equal(requests.length,0)
})


test("요약 설정에 앱 자체 일일 한도가 없다", () => {
  assert.deepEqual(getSummaryConfig(),{key:process.env.SUMMARY_GEMINI_API_KEY})
})
test("기존 사용량이 참고 API 일일 한도를 넘어도 API 응답 전까지 차단하지 않는다", async () => {
  usage.push({dateKey:"2026-10-01",requests:500,nextRequestAt:new Date(),blockedUntil:null})
  assert.equal((await summarizeArticleStep(article)).status,"ready")
  assert.equal(usage[0].requests,501)
  assert.match(requests[0].url,new RegExp(FREE_SUMMARY_MODEL))
})
test("API RPM에 따른 공통 간격 4초가 지나기 전에는 추가 요청을 보내지 않는다", async () => {
  const second={...article,id:"second-article"}
  await summarizeArticleStep(article)
  mock.timers.tick(3999)
  await summarizeArticleStep(second)
  assert.equal(requests.length,1)
  mock.timers.tick(1000)
  await summarizeArticleStep(second)
  assert.equal(requests.length,2)
})
test("요청 간격은 실제 RPM으로 계산하며 입력량을 임의로 추정해 차단하지 않는다", () => {
  assert.equal(getSummaryRequestInterval(),4000)
  assert.equal(getSummaryRequestInterval("gemini-3.8-flash"),12000)
})
test("5만 바이트보다 큰 입력도 자르거나 차단하지 않고 API에 전달한다", async () => {
  const large={...article,title:"A".repeat(51000),content:"한국어 원문 첫 문장입니다.\n\n"+"한국어 원문 문장입니다. ".repeat(10000)}
  assert.equal((await summarizeArticleStep(large)).status,"ready")
  assert.equal(requests.length,1)
  assert.equal(usage[0].requests,1)
  assert.equal(requests[0].input.title,large.title)
  assert.equal(requests[0].input.text,large.content.trim())
})
const rateLimitFixtures: Array<{name:string;body:unknown;headers:Record<string,string>;seconds:number}> = [
  {name:"RetryInfo",body:{error:{details:[{retryDelay:"42.5s"}]}},headers:{},seconds:43},
  {name:"안내 없는 429",body:{},headers:{},seconds:60},
  {name:"형식이 다른 오류 세부 정보",body:{error:{details:{message:"unknown"}}},headers:{},seconds:60},
  {name:"HTTP 날짜 Retry-After",body:{},headers:{"retry-after":"Fri, 02 Oct 2026 01:01:30 GMT"},seconds:90},
  {name:"일일 무료 한도",body:{error:{details:[{violations:[{quotaId:"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{retryDelay:"30s"}]}},headers:{},seconds:21600},
]
for(const fixture of rateLimitFixtures) {
  test(fixture.name+"의 대기 시간을 반영하고 대기 중에는 재호출하지 않는다", async () => {
    let calls=0
    mock.method(globalThis,"fetch",async()=>{calls++;return new Response(JSON.stringify(fixture.body),{status:429,headers:fixture.headers})})
    const waiting=await summarizeArticleStep(article)
    assert.equal(waiting.retryAfterSeconds,fixture.seconds)
    assert.equal(waiting.status,"pending")
    assert.equal(usage[0].requests,1)
    mock.timers.tick((fixture.seconds-1)*1000)
    await summarizeArticleStep(article)
    assert.equal(calls,FREE_SUMMARY_MODELS.length)
    mock.timers.tick(1000)
    await summarizeArticleStep(article)
    assert.equal(calls,FREE_SUMMARY_MODELS.length*2)
  })
}


test("묶음 응답이 잘리면 작은 묶음으로 나눠 재시도한다", async () => {
  const bad={...article,id:"bad",publishedAt:new Date("2026-10-02T00:00:00Z")}
  const good={...article,id:"good",publishedAt:new Date("2026-10-01T00:00:00Z")}
  articles=new Map([[bad.id,bad],[good.id,good]])
  await enqueueArticleSummary(bad);await enqueueArticleSummary(good)
  let calls=0
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    calls++
    if(calls===1)return new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]}))
    return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
  })
  const failed=await processSummaryQueueStep()
  assert.equal(failed.retryAfterSeconds,4)
  assert.equal(rows.every(row=>row.status==="pending"),true)
  assert.equal(rows.every(row=>JSON.parse(String(row.translatedText)).retryBatchSize===1),true)
  mock.timers.tick(4000)
  assert.equal((await processSummaryQueueStep()).newsId,"bad")
  assert.equal(rows.find(row=>row.newsId==="bad")!.status,"ready")
  mock.timers.tick(4000)
  assert.equal((await processSummaryQueueStep()).newsId,"good")
  assert.equal(rows.find(row=>row.newsId==="good")!.status,"ready")
  assert.equal(calls,3)
})

for (const quota of [
  { name: "RPM", quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", seconds: 60 },
  { name: "TPM", quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier", seconds: 60 },
  { name: "RPD", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", seconds: 21600 },
]) {
  test(quota.name + " 한도 오류는 같은 입력을 다음 모델로 즉시 보내고 차단 상태를 보존한다", async () => {
    mock.method(globalThis,"fetch",async (url:string | URL | Request,init?:RequestInit) => {
      const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
      requests.push({url:String(url),input})
      return requests.length === 1 ? new Response(JSON.stringify({error:{details:[
        {violations:[{quotaId:quota.quotaId}]}, {retryDelay:"60s"},
      ]}}),{status:429}) : successfulResponse(input)
    })
    const result=await summarizeArticleStep(article)
    assert.equal(result.status,"ready")
    assert.equal(result.retryAfterSeconds,0)
    assert.equal(result.operation?.outcome,"ready")
    assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
    assert.equal(result.operation?.attempts[0].outcome,"quota")
    assert.equal(result.operation?.attempts[0].quota,quota.name)
    assert.equal(result.operation?.attempts[0].httpStatus,429)
    assert.equal(requests.length,2)
    assert.match(requests[0].url,new RegExp(FREE_SUMMARY_MODEL))
    assert.match(requests[1].url,/gemini-3\.1-flash-lite/)
    assert.deepEqual(requests[0].input,requests[1].input)
    assert.equal(Number(usage[0].blockedUntil)-Date.now(),quota.seconds*1000)
    assert.deepEqual(usage.map(row=>row.requests),[1,1])
    // DB의 모델별 차단 기록을 다음 작업에서도 사용합니다.
    mock.timers.tick(5000)
    assert.equal((await summarizeArticleStep({...article,id:"next-article"})).status,"ready")
    assert.match(requests[2].url,/gemini-3\.1-flash-lite/)
    assert.equal(usage[0].requests,1)
    // 분당 한도가 회복돼도 성공한 대체 모델을 유지하며, 새 날짜에만 기본 모델로 복귀합니다.
    mock.timers.tick(61000)
    await summarizeArticleStep({...article,id:"recovered"})
    assert.match(requests[3].url,/gemini-3\.1-flash-lite/)
    mock.timers.tick(24*3600*1000)
    await summarizeArticleStep({...article,id:"new-day"})
    assert.match(requests[4].url,new RegExp(FREE_SUMMARY_MODEL))
  })
}

test("연속 한도 오류는 정해진 모델 순서로 전환하며 마지막 모델의 결과를 저장한다",async()=>{
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length<FREE_SUMMARY_MODELS.length ? new Response("",{status:429}) : successfulResponse(input)
  })
  assert.equal((await summarizeArticleStep(article)).status,"ready")
  assert.deepEqual(requests.map(request=>request.url.split("/models/")[1].split(":")[0]),FREE_SUMMARY_MODELS.map(item=>item.model))
  assert.equal(usage.filter(row=>row.blockedUntil).length,3)
  assert.equal((await getSummaryAvailability()).retryAfterSeconds,12)
})

test("모든 모델이 한도에 걸리면 가장 빠른 갱신을 기다리고 그 모델부터 재개한다",async()=>{
  const delays=["90","10","30","120"]
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return new Response("",{status:429,headers:{"retry-after":delays[requests.length-1]}})
  })
  const waiting=await summarizeArticleStep(article)
  assert.equal(waiting.status,"pending")
  assert.equal(waiting.retryAfterSeconds,10)
  assert.equal(requests.length,4)
  mock.timers.tick(9000)
  assert.equal((await processSummaryQueueStep()).processed,false)
  assert.equal(requests.length,4)
  mock.timers.tick(1000)
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input});return successfulResponse(input)
  })
  assert.equal((await summarizeArticleStep(article)).status,"ready")
  assert.match(requests[4].url,/gemini-3\.1-flash-lite/)
})

test("인증·서버·응답 오류는 모델을 바꾸거나 다른 모델까지 차단하지 않는다",async()=>{
  for(const status of [400,403,500]) {
    mock.method(globalThis,"fetch",async()=>{requests.push({url:"error",input:{title:"",text:""}});return new Response("",{status})})
    const result=await summarizeArticleStep({...article,id:"error-"+status})
    assert.equal(result.status,"failed")
    assert.equal(result.retryAfterSeconds,3600)
    mock.timers.tick(5000)
  }
  assert.equal(requests.length,3)
  assert.equal(usage.length,1)
  assert.equal(usage[0].blockedUntil,null)
})

test("모델별 요청 간격은 첨부 화면의 API RPM을 따른다",()=>{
  assert.deepEqual(FREE_SUMMARY_MODELS.map(item=>getSummaryRequestInterval(item.model)),[4000,4000,12000,12000])
  for(const item of FREE_SUMMARY_MODELS) {
    assert.ok(60000/getSummaryRequestInterval(item.model)<=item.limits.requestsPerMinute)
    assert.ok(getSummaryRequestInterval(item.model)>=4000)
  }
})

test("현황은 실제 사용량과 참고 API 한도를 표시하되 앱 자체 한도를 두지 않는다",async()=>{
  usage.push(...FREE_SUMMARY_MODELS.map(item=>({dateKey:"2026-10-01",model:item.model,requests:item.limits.requestsPerDay,nextRequestAt:new Date(),blockedUntil:null})))
  const status=await getSummaryQueueSummary()
  assert.equal(status.requests,1040)
  assert.equal(status.model,FREE_SUMMARY_MODEL)
  assert.equal(status.retryAfterSeconds,0)
  assert.equal("dailyLimit" in status,false)
  assert.deepEqual(status.models.map(item=>item.freeTierLimits.requestsPerDay),[500,500,20,20])
})

test("선별·요약 작업도 한도 오류 후 대체 모델의 결과를 검증해 저장한다",async()=>{
  const tech={...article,category:"developer"}
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length===1 ? new Response("",{status:429}) : curationResponse(true,input)
  })
  await enqueueArticleSummary(tech)
  await summarizeArticleStep(tech)
  assert.equal(rows.find(row=>row.kind===CURATION_KIND)?.status,"ready")
  assert.equal((await getListSummaries([tech])).get(tech.id)?.isSummary,true)
  assert.equal(requests.length,2)
})

test("대체 모델 재시도로 60초가 지나도 갱신된 작업 예약을 중복 회수하지 않는다",async()=>{
  let calls=0
  mock.method(globalThis,"fetch",async(_url:string | URL | Request,init?:RequestInit)=>{
    calls++
    mock.timers.tick(45000)
    if(calls===1) return new Response("",{status:429,headers:{"retry-after":"120"}})
    await summarizeArticleStep(article)
    return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
  })
  assert.equal((await summarizeArticleStep(article)).status,"ready")
  assert.equal(calls,2)
  assert.equal(rows.length,1)
})

test("모델 사용 불가 404는 다음 모델로 전환하며 다음 작업에서 재호출하지 않는다",async()=>{
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length===1 ? new Response(JSON.stringify({error:{message:"This model is no longer available to new users."}}),{status:404}) : successfulResponse(input)
  })
  const result=await summarizeArticleStep(article)
  assert.equal(result.operation?.outcome,"ready")
  assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
  assert.equal(result.operation?.attempts[0].outcome,"unavailable")
  assert.equal(result.operation?.attempts[0].httpStatus,404)
  assert.match(result.operation?.attempts[0].reason||"",/no longer available/)
  assert.equal(Number(usage[0].blockedUntil)-Date.now(),21600000)
  mock.timers.tick(5000)
  await summarizeArticleStep({...article,id:"next-article"})
  assert.match(requests[2].url,/gemini-3\.1-flash-lite/)
})

test("실패 로그 정보에는 HTTP 상태·실패 사유·기사별 재시도 대기를 보존하고 키를 숨긴다",async()=>{
  const tech={...article,category:"developer"};articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:"API key "+process.env.SUMMARY_GEMINI_API_KEY+" rejected"}}),{status:403}))
  await enqueueArticleSummary(tech)
  const step=await processSummaryQueueStep()
  assert.equal(step.processed,true)
  assert.equal(step.operation?.outcome,"failed")
  assert.equal(step.operation?.model,FREE_SUMMARY_MODEL)
  assert.equal(step.operation?.attempts[0].httpStatus,403)
  assert.equal(step.operation?.retryAfterSeconds,3600)
  assert.equal(step.retryAfterSeconds,4)
  assert.match(step.operation?.reason||"",/키 숨김/)
  assert.ok(!JSON.stringify(step).includes(process.env.SUMMARY_GEMINI_API_KEY!))
})

test("잘린 응답과 JSON 형식 오류를 구분하고 응답 본문을 오류 로그에 노출하지 않는다",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]})))
  assert.match((await summarizeArticleStep(article)).operation?.reason||"",/MAX_TOKENS/)
  mock.timers.tick(5000)
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"invalid original text"}]}}]})))
  const result=await summarizeArticleStep({...article,id:"invalid-json"})
  assert.equal(result.operation?.outcome,"failed")
  assert.equal(result.operation?.reason,"요약 응답 JSON 형식 오류")
})

test("API가 차단한 모델만 건너뛰고 대체 모델 성공을 작업 결과에 구분한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,requests:450,nextRequestAt:new Date(),blockedUntil:new Date(Date.now()+60000)})
  const result=await summarizeArticleStep(article)
  assert.equal(result.operation?.outcome,"ready")
  assert.equal(result.operation?.attempts[0].outcome,"skipped")
  assert.equal(result.operation?.attempts[0].quota,undefined)
  assert.equal(result.operation?.attempts[1].outcome,"success")
})

test("모델 확인은 대체 모델에만 한 번씩 실제 요청을 예약하고 기사 큐는 수정하지 않는다",async()=>{
  const result=await checkSummaryModels()
  assert.deepEqual(result.map(item=>item.model),FREE_SUMMARY_MODELS.slice(1).map(item=>item.model))
  assert.ok(result.every(item=>item.outcome==="success" && /[가-힣]/.test(item.summary||"")))
  assert.equal(rows.length,0)
  assert.equal(requests.length,3)
  assert.deepEqual(usage.map(row=>row.requests),[1,1,1])
  const waiting=await checkSummaryModels()
  assert.ok(waiting.every(item=>item.outcome==="skipped"))
  assert.equal(requests.length,3)
})

test("오류 로그는 API 키를 제거하고 출력 길이를 제한한다",()=>{
  process.env.GEMINI_API_KEY="a-second-private-key"
  const result=getSummaryErrorMessage(new Error(process.env.SUMMARY_GEMINI_API_KEY+"\n"+process.env.GEMINI_API_KEY+" "+"A".repeat(700)))
  assert.equal(result.length,500)
  assert.ok(!result.includes(process.env.SUMMARY_GEMINI_API_KEY!))
  assert.ok(!result.includes(process.env.GEMINI_API_KEY))
  assert.ok(!result.includes("\n"))
})

for(const status of [502,503,504,"timeout"]) {
  test(status+" 일시 오류는 한도 오류와 구분해 기록하고 다음 모델로 전환한다",async()=>{
    let calls=0
    mock.method(globalThis,"fetch",async(_url:string | URL | Request,init?:RequestInit)=>{
      calls++
      if(calls===1) {
        if(status==="timeout") throw Object.assign(new Error("timeout"),{name:"TimeoutError"})
        return new Response(JSON.stringify({error:{message:"Temporarily overloaded"}}),{status:Number(status)})
      }
      return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
    })
    const result=await summarizeArticleStep(article)
    assert.equal(result.operation?.outcome,"ready")
    assert.equal(result.operation?.attempts[0].outcome,"temporary")
    assert.equal(result.operation?.attempts[0].quota,undefined)
    assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
    assert.equal(Number(usage[0].blockedUntil)-Date.now(),60000)
  })
}

test("모든 모델의 일시적 과부하는 실패 대신 짧은 재시도 대기로 남긴다",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:"High demand"}}),{status:503}))
  const result=await summarizeArticleStep(article)
  assert.equal(result.status,"pending")
  assert.equal(result.operation?.outcome,"waiting")
  assert.equal(result.retryAfterSeconds,60)
  assert.ok(result.operation?.attempts.every(item=>item.outcome==="temporary"))
  assert.ok((await getSummaryAvailability()).models.every(item=>item.quotaStatus==="api_wait"))
})

test("API 요약에 성공해도 DB 저장이 되지 않으면 저장 성공으로 표시하지 않는다",async()=>{
  const updateMany=prisma.newsTranslation.updateMany.bind(prisma.newsTranslation)
  mock.method(prisma.newsTranslation,"updateMany",async(args:Parameters<typeof updateMany>[0])=>{
    if(args.data.status==="ready") return {count:0}
    return updateMany(args)
  })
  const result=await summarizeArticleStep(article)
  assert.equal(result.status,"failed")
  assert.equal(result.operation?.outcome,"failed")
  assert.match(result.operation?.reason||"",/저장하지 못했습니다/)
  assert.equal(rows[0].translatedText,null)
})

test("성공한 대체 모델을 기억해 이전 모델이 회복돼도 다음 기사에서 직접 사용한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,requests:450,nextRequestAt:new Date(),blockedUntil:new Date(Date.now()+21600000)})
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    if(String(url).includes("gemini-3.1-flash-lite")) throw Object.assign(new Error("timeout"),{name:"TimeoutError"})
    return successfulResponse(input)
  })
  const first=await summarizeArticleStep(article)
  assert.equal(first.operation?.model,"gemini-3.8-flash")
  assert.equal(usage[0].activeModel,"gemini-3.8-flash")
  assert.deepEqual(first.operation?.modelSwitches.map(change=>change.to),["gemini-3.1-flash-lite","gemini-3.8-flash"])
  mock.timers.tick(61000)
  const next=await summarizeArticleStep({...article,id:"next-sticky"})
  assert.equal(next.operation?.model,"gemini-3.8-flash")
  assert.deepEqual(next.operation?.modelSwitches,[])
  assert.deepEqual(next.operation?.attempts.map(item=>item.outcome),["success"])
  assert.equal(requests.length,3)
  assert.match(requests[2].url,/gemini-3\.8-flash/)
})

test("DB에 저장된 현재 모델만으로 재시작 후에도 같은 모델에서 시작한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:2,nextRequestAt:new Date(),blockedUntil:null})
  const available=await getSummaryAvailability()
  assert.equal(available.currentModel,"gemini-3.8-flash")
  assert.equal(available.model,"gemini-3.8-flash")
  await summarizeArticleStep(article)
  assert.equal(requests.length,1)
  assert.match(requests[0].url,/gemini-3\.8-flash/)
  assert.equal(usage[0].requests,2)
})

test("기억한 모델의 정상 요청 간격 동안에는 다른 모델로 이동하지 않는다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:0,nextRequestAt:new Date(),blockedUntil:null})
  await summarizeArticleStep(article)
  mock.timers.tick(5000)
  const waiting=await summarizeArticleStep({...article,id:"interval-sticky"})
  assert.equal(waiting.operation?.outcome,"waiting")
  assert.deepEqual(waiting.operation?.modelSwitches,[])
  assert.equal(requests.length,1)
  assert.equal((await getSummaryAvailability()).retryAfterSeconds,7)
  assert.equal((await getSummaryAvailability()).currentModel,"gemini-3.8-flash")
})

test("기억한 모델이 소진되면 그 다음 모델로 전환하고 새 모델을 기억한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:0,nextRequestAt:new Date(),blockedUntil:null})
  usage.push({dateKey:"2026-10-01",model:"gemini-3.8-flash",requests:18,nextRequestAt:new Date(),blockedUntil:new Date(Date.now()+21600000)})
  const result=await summarizeArticleStep(article)
  assert.equal(result.operation?.model,"gemini-3.6-flash")
  assert.deepEqual(result.operation?.modelSwitches.map(change=>[change.from,change.to]),[["gemini-3.8-flash","gemini-3.6-flash"]])
  assert.equal(usage[0].activeModel,"gemini-3.6-flash")
  assert.equal(requests.length,1)
})

test("기사별 검증 실패로 기본 모델을 재탐색하거나 현재 모델을 되돌리지 않는다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,requests:450,nextRequestAt:new Date(),blockedUntil:new Date(Date.now()+21600000)})
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"invalid json"}]}}]})))
  const failed=await summarizeArticleStep(article)
  assert.equal(failed.operation?.outcome,"failed")
  assert.equal(usage[0].activeModel,"gemini-3.1-flash-lite")
  mock.timers.tick(5000)
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input});return successfulResponse(input)
  })
  const next=await summarizeArticleStep({...article,id:"next-after-validation"})
  assert.deepEqual(next.operation?.modelSwitches,[])
  assert.deepEqual(next.operation?.attempts.map(item=>item.model),["gemini-3.1-flash-lite"])
})

test("새 태평양 날짜가 시작되면 이전 기록을 보존하면서 기본 모델로 복귀한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:7,nextRequestAt:new Date(),blockedUntil:null})
  mock.timers.tick(6*3600*1000)
  assert.equal((await getSummaryAvailability()).currentModel,FREE_SUMMARY_MODEL)
  await summarizeArticleStep(article)
  assert.match(requests[0].url,new RegExp(FREE_SUMMARY_MODEL))
  assert.equal(usage[0].activeModel,"gemini-3.8-flash")
  assert.equal(usage[0].requests,7)
  assert.equal(usage[1].dateKey,"2026-10-02")
})

test("모델 확인 명령은 기억한 현재 모델을 바꾸지 않는다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:7,nextRequestAt:new Date(),blockedUntil:null})
  await checkSummaryModels()
  assert.equal(usage[0].activeModel,"gemini-3.8-flash")
  assert.equal(usage[0].requests,7)
})

test("모든 모델이 응답에 실패하면 이전에 기억한 모델은 유지한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_SUMMARY_MODEL,activeModel:"gemini-3.8-flash",requests:7,nextRequestAt:new Date(),blockedUntil:null})
  mock.method(globalThis,"fetch",async()=>new Response("",{status:503}))
  const result=await summarizeArticleStep(article)
  assert.equal(result.operation?.outcome,"waiting")
  assert.deepEqual(result.operation?.attempts.map(item=>item.model),["gemini-3.8-flash","gemini-3.6-flash",FREE_SUMMARY_MODEL,"gemini-3.1-flash-lite"])
  assert.equal(usage[0].activeModel,"gemini-3.8-flash")
})

async function enqueueBatch(lengths: number[]) {
  articles.clear()
  for (const [index, length] of lengths.entries()) {
    const id = "batch-" + index
    const value = { ...article, id, title: "Article " + id,
      content: "Original evidence for " + id + ".\n\n" + "a".repeat(length),
      publishedAt: new Date(Date.now() - index * 1000) }
    articles.set(id, value)
    await enqueueArticleSummary(value)
  }
}
async function changedBatchResponse(input: RequestInput, change: (results: Data[]) => Data[]) {
  const data = await (await successfulResponse(input)).json()
  const payload = JSON.parse(data.candidates[0].content.parts[0].text)
  payload.results = change(payload.results)
  data.candidates[0].content.parts[0].text = JSON.stringify(payload)
  return new Response(JSON.stringify(data))
}

test("짧은 기사 10개를 한 번 요청하고 응답 순서와 무관하게 기사 ID별로 저장한다",async()=>{
  await enqueueBatch(Array(10).fill(500))
  mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body))
    const input=JSON.parse(body.contents[0].parts[0].text)
    requests.push({url:String(url),input})
    assert.equal(input.articles.length,10)
    assert.equal(body.generationConfig.maxOutputTokens,65536)
    assert.match(body.systemInstruction.parts[0].text,/다른 기사의 사실·수치·인용을 섞지/)
    return changedBatchResponse(input,results=>results.reverse().map(result=>({ ...result, title:"한국어 제목 "+result.id })))
  })
  const result=await processSummaryQueueStep()
  assert.equal(result.operations?.length,10)
  assert.equal(requests.length,1)
  assert.equal(usage[0].requests,1)
  for (const row of rows) {
    assert.equal(row.status,"ready")
    const stored=JSON.parse(String(row.translatedText))
    assert.equal(stored.title,"한국어 제목 "+row.newsId)
    assert.deepEqual(stored.evidence,[])
    assert.ok(!String(row.translatedText).includes("Original evidence"))
  }
})

test("보통 길이는 기본 5개씩 처리하고 나머지는 다음 요청으로 보존한다",async()=>{
  await enqueueBatch(Array(10).fill(5000))
  const first=await processSummaryQueueStep()
  assert.equal(first.operations?.length,5)
  assert.equal(rows.filter(row=>row.status==="ready").length,5)
  assert.equal(rows.filter(row=>row.status==="pending").length,5)
  mock.timers.tick(4000)
  assert.equal((await processSummaryQueueStep()).operations?.length,5)
  assert.equal(rows.every(row=>row.status==="ready"),true)
  assert.equal(requests.length,2)
  assert.equal(usage[0].requests,2)
})

test("긴 기사는 묶음만 줄이며 원문 마지막 문단까지 전달한다",async()=>{
  await enqueueBatch([80000,500,500])
  const first=await processSummaryQueueStep()
  assert.equal(first.operations?.length,1)
  assert.equal(requests[0].input.text,articles.get("batch-0")!.content)
  assert.equal(rows.filter(row=>row.status==="ready").length,1)
  mock.timers.tick(4000)
  assert.equal((await processSummaryQueueStep()).operations?.length,2)
  assert.equal(rows.every(row=>row.status==="ready"),true)
})

test("인용 내용은 대조하지 않고 누락된 기사 결과만 재시도한다",async()=>{
  await enqueueBatch(Array(5).fill(500))
  mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    if(requests.length>1) return successfulResponse(input)
    return changedBatchResponse(input,results=>results.slice(0,4).map((result,index)=>index===1?{
      ...result,evidence:["Original evidence for batch-0."],
    }:result))
  })
  const first=await processSummaryQueueStep()
  assert.equal(first.operations?.filter(item=>item.operation?.outcome==="ready").length,4)
  assert.equal(rows.filter(row=>row.status==="ready").length,4)
  assert.equal(rows.filter(row=>row.status==="pending").length,1)
  const saved=rows.filter(row=>row.status==="ready").map(row=>row.translatedText)
  for(let index=0;index<1;index++) {
    mock.timers.tick(4000)
    assert.equal((await processSummaryQueueStep()).operations?.length,1)
  }
  assert.equal(rows.every(row=>row.status==="ready"),true)
  assert.equal(requests.length,2)
  assert.deepEqual(rows.filter(row=>row.newsId!=="batch-4").map(row=>row.translatedText),saved)
})

for(const invalid of ["duplicate","unknown","truncated","invalid-json","context-limit"] as const) {
  test(invalid+" 묶음 오류 후 작은 묶음 크기를 DB에 보존하고 다시 처리한다",async()=>{
    await enqueueBatch(Array(10).fill(500))
    mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
      const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
      requests.push({url:String(url),input})
      if(requests.length>1) return successfulResponse(input)
      if(invalid==="truncated") return new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]}))
      if(invalid==="invalid-json") return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"broken json"}]}}]}))
      if(invalid==="context-limit") return new Response(JSON.stringify({error:{message:"Input token count exceeds context limit"}}),{status:400})
      return changedBatchResponse(input,results=>invalid==="duplicate"?[...results,results[0]]:[{...results[0],id:"unknown"},...results.slice(1)])
    })
    await processSummaryQueueStep()
    assert.equal(rows.every(row=>row.status==="pending"),true)
    assert.equal(rows.every(row=>JSON.parse(String(row.translatedText)).retryBatchSize===5),true)
    mock.timers.tick(4000)
    assert.equal((await processSummaryQueueStep()).operations?.length,5)
    mock.timers.tick(4000)
    assert.equal((await processSummaryQueueStep()).operations?.length,5)
    assert.equal(rows.every(row=>row.status==="ready"),true)
    assert.equal(requests.length,3)
  })
}

test("묶음 요청도 API 한도 응답 이후에만 모델을 바꾸고 전체 입력을 유지한다",async()=>{
  await enqueueBatch(Array(10).fill(500))
  mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length===1?new Response("",{status:429}):successfulResponse(input)
  })
  const result=await processSummaryQueueStep()
  assert.equal(result.operations?.length,10)
  assert.equal(rows.every(row=>row.status==="ready"),true)
  assert.deepEqual(requests[0].input,requests[1].input)
  assert.deepEqual(usage.map(row=>row.requests),[1,1])
  assert.match(requests[1].url,/gemini-3\.1-flash-lite/)
})

test("같은 기사 묶음을 여러 워커가 동시에 처리해도 요청을 중복 전송하지 않는다",async()=>{
  await enqueueBatch(Array(10).fill(500))
  await Promise.all([processSummaryQueueStep(),processSummaryQueueStep(),processSummaryQueueStep()])
  assert.equal(requests.length,1)
  assert.equal(usage[0].requests,1)
  for(let index=0;index<10 && rows.some(row=>row.status!=="ready");index++) {
    mock.timers.tick(4000)
    await processSummaryQueueStep()
  }
  assert.equal(rows.every(row=>row.status==="ready"),true)
  const ids=requests.flatMap(request=>request.input.articles?.map(item=>item.id) ?? [
    [...articles.values()].find(item=>item.title===request.input.title)!.id,
  ])
  assert.equal(ids.length,10)
  assert.equal(new Set(ids).size,10)
})

test("묶음 크기는 분량과 재시도 이력을 따르되 긴 단일 입력을 거부하지 않는다",()=>{
  assert.equal(getSummaryBatchSize([]),0)
  assert.equal(getSummaryBatchSize(Array.from({length:10},()=>({text:"a".repeat(2000)}))),10)
  assert.equal(getSummaryBatchSize(Array.from({length:10},()=>({text:"a".repeat(5000)}))),5)
  assert.equal(getSummaryBatchSize(Array.from({length:10},()=>({text:"a".repeat(11000)}))),2)
  assert.equal(getSummaryBatchSize([{text:"a".repeat(1000000)}]),1)
  assert.equal(getSummaryBatchSize([{text:"short",retryBatchSize:1},{text:"short"}]),1)
})

test("120초 묶음 요청 중에도 모든 기사 예약을 갱신해 다른 워커의 중복 회수를 막는다",async()=>{
  mock.timers.reset()
  mock.timers.enable({apis:["Date","setInterval"],now:Date.parse("2026-10-02T01:00:00Z")})
  await enqueueBatch(Array(10).fill(500))
  let calls=0
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    calls++
    for(let index=0;index<4;index++) {
      mock.timers.tick(20000)
      // 비동기 DB 갱신이 기사 전체에 적용되도록 마이크로태스크를 진행합니다.
      for(let task=0;task<30;task++) await Promise.resolve()
      assert.equal((await processSummaryQueueStep()).processed,false)
    }
    return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
  })
  await processSummaryQueueStep()
  assert.equal(calls,1)
  assert.equal(rows.every(row=>row.status==="ready"),true)
})

test("기존 큐에 미분류 기사가 남아 있어도 정상 기사 묶음의 처리를 막지 않는다",async()=>{
  await enqueueBatch([500,500])
  for(let index=0;index<12;index++) {
    const value={...article,id:"unsupported-"+index,category:"unknown",publishedAt:new Date(Date.now()+10000)}
    articles.set(value.id,value)
    rows.push({id:"unsupported-row-"+index,newsId:value.id,kind:CURATION_KIND,chunkIndex:0,
      sourceHash:getCurationHash(value),status:"pending",retryAt:null,startedAt:null,translatedText:null})
  }
  const result=await processSummaryQueueStep()
  assert.equal(result.operations?.length,2)
  assert.equal(rows.filter(row=>row.status==="ready").length,2)
  assert.equal(requests.length,1)
})
