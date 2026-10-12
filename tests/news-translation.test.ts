import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { afterEach, beforeEach, mock, test } from "node:test"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import {
  FREE_TRANSLATION_MODEL, FREE_TRANSLATION_MODELS, getTranslationAvailability, getTranslationQueueSummary,
  checkTranslationModels, getTranslationErrorMessage,
  getArticleTranslation, getListTranslations, getTranslationConfig,
  getTranslationPreview, protectTranslationText, restoreTranslationText, splitTranslationText,
  translateArticleStep, enqueueArticleTranslation, enqueueExistingNews, getKoreanRatio, isTranslationArticle,
  processTranslationQueueStep, getNextTranslationDayStart, getTranslationRequestInterval,
} from "../lib/news-translation"
import { POST as translateRoute } from "../app/api/news/[id]/translate/route"
import { CURATION_KIND, getCurationHash } from "../lib/news-curation"

type Data = Record<string, unknown>
const original = { news: prisma.news, translation: prisma.newsTranslation, usage: prisma.newsTranslationUsage }
const envNames = ["TRANSLATION_GEMINI_API_KEY", "TRANSLATION_FREE_TIER_CONFIRMED", "TRANSLATION_DAILY_REQUEST_LIMIT", "GEMINI_API_KEY", "GEMINI_MODEL"] as const
let oldEnv: Map<string, string | undefined>
let rows: Data[]
let usage: Data[]
let articles: Map<string, typeof article & {publishedAt?:Date}>
let requests: Array<{ url: string; input: { title: string; text: string } }>
const article = { id: "translation-test", source: "JetBrains IntelliJ IDEA", title: "Faster builds in Node.js 24.0",
  description: "The compiler is now faster.", content: "The compiler is faster with Node.js 24.0.\n\nRun the command below.\n\nnpm install example@2.0\n\nThe final paragraph describes compatibility." }
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const conflict = () => Object.assign(new Error("고유 예약 충돌"), { code: "P2002" })

function matches(row: Data, where: Data = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Data[]).some((condition) => matches(row, condition))
    if (key === "dateKey_model") return matches(row, expected as Data)
    if (key === "news") return matches(articles.get(String(row.newsId)) as unknown as Data, expected as Data)
    const value = key === "model" ? row.model || FREE_TRANSLATION_MODEL : row[key]
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
function successfulResponse(input: { title: string; text: string }) {
  return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
    title: input.title ? "한국어 제목: " + input.title : "",
    text: input.text ? "한국어 번역: " + input.text : "",
  }) }] } }] }))
}
function curationResponse(selected: boolean, input: {title:string;text:string}, summary = "컴파일러가 개선됐습니다. 호환성 변화와 빌드 과정을 함께 살펴볼 만한 소식입니다.") {
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({
    selected,title:selected?"컴파일러의 빌드 과정 개선":"",summary:selected?summary:"",reason:selected?"개발 실무의 변화":"단순 홍보",evidence:selected?[input.text.split("\n\n")[0]]:[],
  })}]} }]}))
}
beforeEach(() => {
  oldEnv = new Map(envNames.map((name) => [name, process.env[name]]))
  process.env.TRANSLATION_GEMINI_API_KEY = "fake-key-only-for-mock"
  process.env.TRANSLATION_FREE_TIER_CONFIRMED = "true"
  process.env.TRANSLATION_DAILY_REQUEST_LIMIT = ""
  rows = []; usage = []; requests = []; articles = new Map([[article.id,article]])
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-02T01:00:00Z") })
  Object.defineProperty(prisma, "news", { configurable: true, value: {
    findMany: async () => [...articles.values()], findUnique: async () => article,
  } })
  Object.defineProperty(prisma, "newsTranslation", { configurable: true, value: {
    findMany: async ({ where }: { where: Data }) => rows.filter((row) => matches(row, where)),
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
      if (usage.some((row) => row.dateKey === data.dateKey && (row.model || FREE_TRANSLATION_MODEL) === data.model)) throw conflict()
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

test("기술 기사는 선별을 먼저 처리하고 채택한 뒤에만 전체 번역을 등록한다", async () => {
  const tech={...article,category:"developer"}
  articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input}); return curationResponse(true,input)
  })
  await enqueueArticleTranslation(tech)
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND])
  assert.equal((await getListTranslations([tech])).size,0)
  await processTranslationQueueStep()
  assert.equal(rows[0].status,"ready")
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND,"content"])
  const summary=(await getListTranslations([tech])).get(tech.id)!
  assert.equal(summary.isSummary,true)
  assert.match(summary.preview,/호환성/)
  assert.equal((await getArticleTranslation(tech)).contentStatus,"pending")
  assert.equal((await getArticleTranslation(tech)).isSummary,true)
  assert.equal(usage[0].requests,1)
})

test("한국어 기술 기사도 AI로 선별·요약하고 전체 번역은 요청하지 않는다",async()=>{
  const tech={...article,category:"105",title:"컴파일러 변화",content:"컴파일러에서 빌드 과정을 개선했습니다. 적용할 때는 프로젝트의 호환성을 확인해야 합니다."}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return curationResponse(true,input)
  })
  await enqueueArticleTranslation(tech)
  await translateArticleStep(tech)
  assert.deepEqual(rows.map(r=>r.kind),[CURATION_KIND])
  assert.equal((await getListTranslations([tech])).get(tech.id)?.isSummary,true)
  assert.equal(requests.length,1)
})

test("제외 결정은 재등록·워커 실행으로 재요청하지 않고 목록에도 나타나지 않는다",async()=>{
  const tech={...article,category:"engineering"};articles.set(tech.id,tech)
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:"curation",input});return curationResponse(false,input)
  })
  await enqueueArticleTranslation(tech);await processTranslationQueueStep()
  assert.equal(rows[0].status,"rejected")
  await enqueueArticleTranslation(tech);await processTranslationQueueStep()
  assert.equal(requests.length,1)
  assert.equal((await getListTranslations([tech])).size,0)
  assert.equal(rows.length,1)
})

test("원문에 없는 수치가 포함된 요약은 게시하지 않고 실패로 남긴다",async()=>{
  const tech={...article,category:"ai"}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    return curationResponse(true,input,"빌드 속도가 999% 개선됐습니다.")
  })
  await enqueueArticleTranslation(tech);await translateArticleStep(tech)
  assert.equal(rows[0].status,"failed")
  assert.equal((await getListTranslations([tech])).size,0)
  assert.equal(rows.length,1)
})

test("선별한 기사의 본문이 변경되면 새 선별이 끝날 때까지 요약을 숨긴다",async()=>{
  const tech={...article,category:"release"}
  mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    return curationResponse(true,input)
  })
  await enqueueArticleTranslation(tech);await translateArticleStep(tech)
  const changed={...tech,content:tech.content+"\n\nA changed final finding."}
  await enqueueArticleTranslation(changed)
  assert.equal(rows.find(r=>r.kind===CURATION_KIND)?.status,"pending")
  assert.equal(rows.find(r=>r.kind===CURATION_KIND)?.sourceHash,getCurationHash(changed))
  assert.equal((await getListTranslations([changed])).size,0)
})

test("빈 번역 키는 기존 Gemini 키가 있어도 외부 요청을 하지 않는다", async () => {
  process.env.TRANSLATION_GEMINI_API_KEY = ""
  process.env.GEMINI_API_KEY = "existing-key-must-not-be-used"
  assert.equal(getTranslationConfig(), null)
  assert.equal((await translateArticleStep(article)).enabled, false)
  await enqueueArticleTranslation(article)
  assert.equal(requests.length, 0)
  assert.equal(usage.length, 0)
})
test("무료 프로젝트 확인과 유효한 자체 한도가 없으면 번역을 켜지 않는다", async () => {
  for (const confirmation of ["", "false", "TRUE"]) {
    process.env.TRANSLATION_FREE_TIER_CONFIRMED = confirmation
    assert.equal(getTranslationConfig(), null)
  }
  process.env.TRANSLATION_FREE_TIER_CONFIRMED = "true"
  for (const limit of ["0", "-1", "501", "NaN", "1.5"]) {
    process.env.TRANSLATION_DAILY_REQUEST_LIMIT = limit
    assert.equal(getTranslationConfig(), null)
  }
  assert.equal(requests.length, 0)
})
test("한국어 본문과 제외 출처는 번역하지 않으며 출처 언어 라벨만으로 건너뛰지 않는다", async () => {
  for (const source of ["NAVER D2","Toss Tech","Microsoft Visual Studio"]) {
    assert.equal((await getArticleTranslation({...article,source,content:"한국어로 작성한 기사 본문"})).applicable,false)
  }
  for (const source of ["GeekNews","Hacker News"]) {
    assert.equal((await translateArticleStep({...article,source})).applicable,false)
  }
  assert.equal(isTranslationArticle({...article,source:"NAVER D2"}),true)
  assert.equal(requests.length,0)
})

test("동시에 같은 제목 번역을 요청해도 API는 한 번만 호출한다", async () => {
  await Promise.all(Array.from({ length: 5 }, () => translateArticleStep(article, "preview")))
  assert.equal(requests.length, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, "ready")
  assert.equal(usage[0].requests, 1)
  process.env.GEMINI_MODEL = "a-paid-model-must-not-be-used"
  await translateArticleStep(article, "preview")
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, new RegExp(FREE_TRANSLATION_MODEL))
})
test("저장한 제목 번역은 키를 비워도 재사용하고 원문 변경 시 숨긴다", async () => {
  await translateArticleStep(article, "preview")
  process.env.TRANSLATION_GEMINI_API_KEY = ""
  const translated = await getListTranslations([article])
  assert.match(translated.get(article.id)!.title, /한국어 제목/)
  assert.equal((await getListTranslations([{ ...article, title: "Changed original" }])).size, 0)
  assert.equal(requests.length, 1)
  assert.equal(article.title, "Faster builds in Node.js 24.0")
})
test("목록 발췌와 전체 기사에서 같은 소개의 캐시 해시를 사용한다", () => {
  const value = { ...article, description: ("An original description. ").repeat(100), content: ("An original description. ").repeat(100) + "\n\nBody" }
  assert.deepEqual(getTranslationPreview(value), getTranslationPreview({ ...value, content: value.content.slice(0, 1200) }))
})
test("긴 본문은 8000자 뒤의 마지막 문단까지 번역하며 코드·버전을 보존한다", async () => {
  const content = Array.from({ length: 100 }, (_, index) => "Paragraph " + index + ": " + "Detailed compatibility information. ".repeat(5)).join("\n\n")
    + "\n\n" + "\x60\x60\x60js\nconst version = '24.0';\n\x60\x60\x60" + "\n\nTHE_FINAL_PARAGRAPH"
  const large = { ...article, content }
  let view = await getArticleTranslation(large)
  for (let step = 0; step < 20 && view.contentStatus !== "ready"; step++) {
    view = await translateArticleStep(large); mock.timers.tick(11000)
  }
  assert.equal(view.contentStatus, "ready")
  assert.ok(view.totalChunks > 2)
  assert.match(view.content!, /THE_FINAL_PARAGRAPH/)
  assert.match(view.content!, /const version = '24\.0';/)
  assert.equal(requests.length, view.totalChunks + 1)
})
test("429 후 완료된 본문 조각을 재번역하지 않고 이어서 처리한다", async () => {
  const large = { ...article, content: Array.from({ length: 120 }, (_, i) => "Paragraph " + i + ". " + "More technical details. ".repeat(4)).join("\n\n") }
  await translateArticleStep(large); mock.timers.tick(11000)
  await translateArticleStep(large); mock.timers.tick(11000)
  const before = String(rows.find((row) => row.kind === "content")!.translatedText)
  mock.method(globalThis, "fetch", async () => new Response("", { status: 429, headers: { "retry-after": "60" } }))
  const waiting = await translateArticleStep(large)
  assert.equal(waiting.content, null)
  assert.equal(waiting.completedChunks, 1)
  assert.equal(waiting.retryAfterSeconds, 60)
  assert.equal(rows.find((row) => row.kind === "content")!.translatedText, before)
  await translateArticleStep(large)
  assert.equal(waiting.completedChunks, 1)
  mock.timers.tick(61000)
  mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({ url: "resume", input }); return successfulResponse(input)
  })
  let complete = await getArticleTranslation(large)
  for (let i = 0; i < 10 && complete.contentStatus !== "ready"; i++) {
    complete = await translateArticleStep(large); mock.timers.tick(11000)
  }
  assert.equal(complete.contentStatus, "ready")
  assert.ok(complete.content!.startsWith(before))
  assert.equal(requests.filter((request) => request.input.text.includes("Paragraph __NH_")).length >= 1, true)
})
test("모든 모델의 앱 하루 요청 한도를 넘으면 다음 날짜에 이어서 처리한다", async () => {
  process.env.TRANSLATION_DAILY_REQUEST_LIMIT = "1"
  usage.push(...FREE_TRANSLATION_MODELS.slice(1).map(({model}) => ({model,dateKey:"2026-10-01",requests:1,nextRequestAt:new Date(),blockedUntil:null})))
  await translateArticleStep(article); mock.timers.tick(11000)
  const waiting = await translateArticleStep(article)
  assert.equal(requests.length, 1)
  assert.equal(waiting.contentStatus, "pending")
  assert.ok(waiting.retryAfterSeconds > 3600)
  mock.timers.tick(24 * 3600 * 1000)
  const complete = await translateArticleStep(article)
  assert.equal(complete.contentStatus, "ready")
  assert.equal(requests.length, 2)
})
test("보호된 코드·명령어·수치가 사라지거나 반복되면 응답을 거절한다", () => {
  const originalText = "Use Node.js 24.0 and https://example.com/docs.\n\nnpm install example@2.0\n\n\x60api.call()\x60"
  const protectedText = protectTranslationText(originalText)
  assert.equal(restoreTranslationText(protectedText.text, protectedText.tokens), originalText)
  const token = [...protectedText.tokens.keys()][0]
  assert.throws(() => restoreTranslationText(protectedText.text.replace(token, ""), protectedText.tokens))
  assert.throws(() => restoreTranslationText(protectedText.text + token, protectedText.tokens))
})
test("조각 분리는 원문·식별자·유니코드를 빠짐없이 보존한다", () => {
  const source = ("Text 😃 ".repeat(1500)) + "\n\n" + "Z".repeat(13000)
  const parts = splitTranslationText(source)
  assert.equal(parts.join(""), source)
  assert.ok(parts.every((part) => part.length <= 6000))
})
test("잘린 응답은 번역 완료로 저장하지 않는다", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] })))
  assert.equal((await translateArticleStep(article)).previewStatus, "failed")
  assert.equal(rows[0].translatedTitle, null)
})
test("본문 보호 식별자를 잃은 응답은 실패로 남기고 원문을 보존한다", async () => {
  mock.method(globalThis, "fetch", async () => successfulResponse({ title: "한국어", text: "누락된 수치" }))
  assert.equal((await translateArticleStep(article)).previewStatus, "failed")
  assert.equal(article.content, "The compiler is faster with Node.js 24.0.\n\nRun the command below.\n\nnpm install example@2.0\n\nThe final paragraph describes compatibility.")
})
test("원문 수정으로 무효화된 본문 캐시는 표시하지 않는다", async () => {
  const input = getTranslationPreview(article)
  rows.push({ id: "old", newsId: article.id, kind: "preview", chunkIndex: 0, status: "ready", sourceHash: digest(JSON.stringify(input)), translatedTitle: "기존 한국어", translatedText: "기존 소개", retryAt: null })
  const view = await getArticleTranslation({ ...article, description: "Updated intro" })
  assert.equal(view.title, null)
})
test("번역 API는 교차 출처·제외 출처·없는 기사를 거절한다", async () => {
  const call = (origin?: string) => translateRoute(new NextRequest("http://localhost/api/news/test/translate", { method: "POST", headers: origin ? { origin } : {} }), { params: Promise.resolve({ id: "test" }) })
  assert.equal((await call("https://outside.example")).status, 403)
  mock.method(prisma.news, "findUnique", async () => null)
  assert.equal((await call()).status, 404)
  mock.method(prisma.news, "findUnique", async () => ({ ...article, source: "GeekNews" }))
  assert.equal((await call()).status, 404)
  assert.equal(requests.length, 0)
})

test("영문 그대로인 응답은 한국어 번역 완료로 저장하지 않는다", async () => {
  const value = { ...article, title: "New feature", description: "An English article", content: "An English body" }
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({title:value.title,text:value.description}) }] } }] })))
  assert.equal((await translateArticleStep(value)).previewStatus, "failed")
  assert.equal(rows[0].translatedTitle, null)
})
test("서로 다른 기사도 공통 요청 간격으로 API 동시 호출을 제한한다", async () => {
  await Promise.all(Array.from({length:4},(_,i)=>translateArticleStep({...article,id:"other-"+i},"preview")))
  assert.equal(requests.length,1)
  assert.equal(usage[0].requests,1)
  assert.equal(rows.filter((row)=>row.status==="pending").length,3)
})
test("코드 명령어와 보안 식별자는 원문 그대로 복원한다", () => {
  const text = "Fix CVE-2026-12345 with api.call(value).\nnode --version\nnpm run build"
  const protectedText = protectTranslationText(text)
  assert.doesNotMatch(protectedText.text,/CVE-2026-12345|api.call\(value\)|node --version|npm run build/)
  assert.equal(restoreTranslationText(protectedText.text,protectedText.tokens),text)
})


test("한글 비율은 50% 경계와 코드·URL·숫자를 구분한다", () => {
  assert.equal(getKoreanRatio("abcd가나다라"), 0.5)
  assert.ok(getKoreanRatio("abcd가나다") < 0.5)
  assert.equal(getKoreanRatio("한글 설명\n\n\x60\x60\x60js\nconst message = 'a long English code sample';\n\x60\x60\x60\nhttps://example.com/english/path 1234"), 1)
  assert.equal(getKoreanRatio("1234 https://example.com"), 1)
  assert.equal(isTranslationArticle({...article,content:"abcd가나다라"}),false)
  assert.equal(isTranslationArticle({...article,content:"abcd가나다"}),true)
})

test("키가 비어 있어도 큐를 저장하며 중복 등록으로 완료 캐시를 지우지 않는다", async () => {
  process.env.TRANSLATION_GEMINI_API_KEY = ""
  const first = await enqueueArticleTranslation(article)
  const second = await enqueueArticleTranslation(article)
  assert.equal(first.added,2)
  assert.equal(second.added,0)
  assert.equal(rows.length,2)
  assert.equal(requests.length,0)
  process.env.TRANSLATION_GEMINI_API_KEY = "fake-key-only-for-mock"
  await processTranslationQueueStep(); mock.timers.tick(11000)
  await processTranslationQueueStep()
  const completed = rows.map((row)=>row.translatedText)
  await enqueueArticleTranslation(article)
  assert.deepEqual(rows.map((row)=>row.translatedText),completed)
  assert.equal(rows.every((row)=>row.status==="ready"),true)
  assert.equal(requests.length,2)
})

test("기존 기사 일괄 등록은 한국어와 제외 커뮤니티를 건너뛴다", async () => {
  const korean = {...article,id:"ko",source:"Microsoft Visual Studio",content:"한국어로 작성한 기사 본문"}
  const foreign = {...article,id:"foreign",source:"NAVER D2"}
  const excluded = {...article,id:"excluded",source:"Hacker News"}
  articles.set(korean.id,korean);articles.set(foreign.id,foreign);articles.set(excluded.id,excluded)
  mock.method(prisma.news,"findMany",async()=>[korean,foreign])
  const result = await enqueueExistingNews()
  assert.equal(result.checked,2)
  assert.equal(result.eligible,1)
  assert.equal(rows.every((row)=>row.newsId==="foreign"),true)
  assert.equal(requests.length,0)
})

test("원문 변경과 짧아진 본문은 캐시를 무효화하고 불필요한 큐 조각을 제거한다", async () => {
  const large={...article,content:("Long foreign content. ").repeat(1000)}
  await enqueueArticleTranslation(large)
  assert.ok(rows.length>3)
  await translateArticleStep(large); mock.timers.tick(11000)
  await enqueueArticleTranslation({...article,title:"Changed title",content:"Changed original body"})
  assert.equal(rows.length,2)
  assert.equal(rows.every((row)=>row.status==="pending" && row.translatedText===null),true)
  await enqueueArticleTranslation({...article,content:"한국어로 수정한 원문입니다."})
  assert.equal(rows.length,0)
})

test("큐 워커는 최신 기사부터 처리하며 같은 날짜 한도를 초과하지 않는다", async () => {
  const older={...article,id:"older",publishedAt:new Date("2026-09-01")}
  const newer={...article,id:"newer",publishedAt:new Date("2026-10-01")}
  articles.set(older.id,older);articles.set(newer.id,newer)
  await enqueueArticleTranslation(older);await enqueueArticleTranslation(newer)
  process.env.TRANSLATION_DAILY_REQUEST_LIMIT="1"
  usage.push(...FREE_TRANSLATION_MODELS.slice(1).map(({model}) => ({model,dateKey:"2026-10-01",requests:1,nextRequestAt:new Date(),blockedUntil:null})))
  const first=await processTranslationQueueStep()
  assert.equal(first.newsId,"newer")
  assert.equal(requests.length,1)
  mock.timers.tick(11000)
  const waiting=await processTranslationQueueStep()
  assert.equal(waiting.processed,false)
  assert.ok(waiting.retryAfterSeconds>3600)
  assert.equal(requests.length,1)
  mock.timers.tick(24*3600*1000)
  const resumed=await processTranslationQueueStep()
  assert.equal(resumed.newsId,"newer")
  assert.equal((await getArticleTranslation(newer)).contentStatus,"ready")
  assert.equal(requests.length,2)
})

test("큐 워커의 동시 실행과 중단된 예약은 API를 중복 호출하지 않는다", async () => {
  await enqueueArticleTranslation(article)
  await Promise.all([processTranslationQueueStep(),processTranslationQueueStep(),processTranslationQueueStep()])
  assert.equal(requests.length,1)
  mock.timers.tick(11000)
  const body=rows.find((row)=>row.kind==="content")!
  body.status="processing";body.startedAt=new Date(Date.now()-61000)
  await processTranslationQueueStep()
  assert.equal(body.status,"ready")
  assert.equal(requests.length,2)
})

test("번역 상태 POST 조회는 큐 작업과 API 요청을 시작하지 않는다", async () => {
  const response=await translateRoute(new NextRequest("http://localhost/api/news/test/translate",{method:"POST"}),{params:Promise.resolve({id:article.id})})
  assert.equal(response.status,200)
  assert.equal((await response.json()).translation.contentStatus,"pending")
  assert.equal(rows.length,0)
  assert.equal(requests.length,0)
})

test("미국 태평양 날짜의 한도 갱신 시각은 서머타임을 반영한다", () => {
  assert.equal(getNextTranslationDayStart(new Date("2026-10-02T05:30:00Z")).toISOString(),"2026-10-02T07:00:00.000Z")
  assert.equal(getNextTranslationDayStart(new Date("2026-12-02T05:30:00Z")).toISOString(),"2026-12-02T08:00:00.000Z")
})

test("기사 ID가 없는 큐 등록은 DB 변경 전에 거절한다", async () => {
  await enqueueArticleTranslation(article)
  const before=rows.length
  await assert.rejects(()=>enqueueArticleTranslation({...article,id:"",content:"한국어 기사"}),/기사 ID/)
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
  assert.equal((await enqueueArticleTranslation(article)).added,2)
  assert.equal(attempts,2)
  assert.equal(requests.length,0)
})


test("빈 자체 한도는 450회이며 무료 상한 500회까지 허용한다", () => {
  assert.equal(getTranslationConfig()!.dailyLimit, 450)
  process.env.TRANSLATION_DAILY_REQUEST_LIMIT = "500"
  assert.equal(getTranslationConfig()!.dailyLimit, 500)
})
test("기존 기본 모델 사용량을 보존하고 450회 이후 다음 모델로 전환한다", async () => {
  usage.push({dateKey:"2026-10-01",requests:449,nextRequestAt:new Date(),blockedUntil:null})
  await translateArticleStep(article)
  assert.equal(usage[0].requests,450)
  mock.timers.tick(5000)
  const complete = await translateArticleStep(article)
  assert.equal(requests.length,2)
  assert.equal(usage[0].requests,450)
  assert.equal(complete.contentStatus,"ready")
  assert.equal(usage[1].requests,1)
  assert.match(requests[1].url,/gemini-3\.1-flash-lite/)
  mock.timers.tick(21600*1000)
  await translateArticleStep({...article,id:"next-day"})
  assert.match(requests[2].url,new RegExp(FREE_TRANSLATION_MODEL))
})
test("공통 간격 5초가 지나기 전에는 추가 요청을 보내지 않는다", async () => {
  await translateArticleStep(article)
  mock.timers.tick(4999)
  await translateArticleStep(article)
  assert.equal(requests.length,1)
  // 재시도 시각은 초 단위로 올림하므로 1ms 남은 경우 1초 더 대기한다.
  mock.timers.tick(1000)
  await translateArticleStep(article)
  assert.equal(requests.length,2)
})
test("큰 유니코드 입력은 간격을 늘리고 연속 60초의 입력 예산을 지킨다", () => {
  assert.equal(getTranslationRequestInterval("small input"),5000)
  assert.ok(getTranslationRequestInterval("日".repeat(7000))>5000)
  assert.throws(()=>getTranslationRequestInterval("日".repeat(17000)))
  const costs=[50000,50000,50000,50000,50000,12000,40000,25000,49000,5000]
  const events: Array<{at:number;tokens:number}>=[]
  let at=0
  for(const tokens of costs) {
    events.push({at,tokens})
    at+=getTranslationRequestInterval("a".repeat(tokens-256))
  }
  for(const event of events) assert.ok(events.filter((item)=>item.at<=event.at&&item.at>event.at-60000).reduce((sum,item)=>sum+item.tokens,0)<=250000)
})
test("너무 큰 제목은 API 호출과 사용량 예약 없이 원문을 유지한다", async () => {
  const large={...article,title:"A".repeat(51000)}
  assert.equal((await translateArticleStep(large)).previewStatus,"failed")
  assert.equal(requests.length,0)
  assert.equal(usage.length,0)
  assert.equal(large.title.length,51000)
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
    const waiting=await translateArticleStep(article)
    assert.equal(waiting.retryAfterSeconds,fixture.seconds)
    assert.equal(waiting.previewStatus,"pending")
    assert.equal(usage[0].requests,1)
    mock.timers.tick((fixture.seconds-1)*1000)
    await translateArticleStep(article)
    assert.equal(calls,FREE_TRANSLATION_MODELS.length)
    mock.timers.tick(1000)
    await translateArticleStep(article)
    assert.equal(calls,FREE_TRANSLATION_MODELS.length*2)
  })
}


test("한 기사 번역 실패는 해당 기사만 대기시키고 다른 기사를 계속 처리한다", async () => {
  const bad={...article,id:"bad",content:"",publishedAt:new Date("2026-10-02T00:00:00Z")}
  const good={...article,id:"good",content:"",publishedAt:new Date("2026-10-01T00:00:00Z")}
  articles=new Map([[bad.id,bad],[good.id,good]])
  await enqueueArticleTranslation(bad)
  await enqueueArticleTranslation(good)
  let calls=0
  mock.method(globalThis,"fetch",async(_input:string | URL | Request,init?:RequestInit)=>{
    calls++
    if(calls===1)return new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]}))
    return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
  })
  const failed=await processTranslationQueueStep()
  assert.equal(failed.retryAfterSeconds,5)
  assert.equal(rows.find(row=>row.newsId==="bad")!.status,"failed")
  assert.equal(Number(rows.find(row=>row.newsId==="bad")!.retryAt)-Date.now(),3600000)
  mock.timers.tick(5000)
  assert.equal((await processTranslationQueueStep()).newsId,"good")
  assert.equal(rows.find(row=>row.newsId==="good")!.status,"ready")
  assert.equal(calls,2)
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
    const result=await translateArticleStep(article)
    assert.equal(result.previewStatus,"ready")
    assert.equal(result.retryAfterSeconds,0)
    assert.equal(result.operation?.outcome,"ready")
    assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
    assert.equal(result.operation?.attempts[0].outcome,"quota")
    assert.equal(result.operation?.attempts[0].quota,quota.name)
    assert.equal(result.operation?.attempts[0].httpStatus,429)
    assert.equal(requests.length,2)
    assert.match(requests[0].url,new RegExp(FREE_TRANSLATION_MODEL))
    assert.match(requests[1].url,/gemini-3\.1-flash-lite/)
    assert.deepEqual(requests[0].input,requests[1].input)
    assert.equal(Number(usage[0].blockedUntil)-Date.now(),quota.seconds*1000)
    assert.deepEqual(usage.map(row=>row.requests),[1,1])
    // DB의 모델별 차단 기록을 다음 작업에서도 사용합니다.
    mock.timers.tick(5000)
    assert.equal((await translateArticleStep(article)).contentStatus,"ready")
    assert.match(requests[2].url,/gemini-3\.1-flash-lite/)
    assert.equal(usage[0].requests,1)
    // 분당 한도가 회복되면 우선순위가 높은 모델을 다시 사용합니다.
    mock.timers.tick(quota.seconds*1000)
    await translateArticleStep({...article,id:"recovered"})
    assert.match(requests[3].url,new RegExp(FREE_TRANSLATION_MODEL))
  })
}

test("연속 한도 오류는 정해진 모델 순서로 전환하며 마지막 모델의 결과를 저장한다",async()=>{
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length<FREE_TRANSLATION_MODELS.length ? new Response("",{status:429}) : successfulResponse(input)
  })
  assert.equal((await translateArticleStep(article)).previewStatus,"ready")
  assert.deepEqual(requests.map(request=>request.url.split("/models/")[1].split(":")[0]),FREE_TRANSLATION_MODELS.map(item=>item.model))
  assert.equal(usage.filter(row=>row.blockedUntil).length,3)
  assert.equal((await getTranslationAvailability(450)).retryAfterSeconds,13)
})

test("모든 모델이 한도에 걸리면 가장 빠른 갱신을 기다리고 그 모델부터 재개한다",async()=>{
  const delays=["90","10","30","120"]
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return new Response("",{status:429,headers:{"retry-after":delays[requests.length-1]}})
  })
  const waiting=await translateArticleStep(article)
  assert.equal(waiting.previewStatus,"pending")
  assert.equal(waiting.retryAfterSeconds,10)
  assert.equal(requests.length,4)
  mock.timers.tick(9000)
  assert.equal((await processTranslationQueueStep()).processed,false)
  assert.equal(requests.length,4)
  mock.timers.tick(1000)
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input});return successfulResponse(input)
  })
  assert.equal((await translateArticleStep(article)).previewStatus,"ready")
  assert.match(requests[4].url,/gemini-3\.1-flash-lite/)
})

test("인증·서버·응답 오류는 모델을 바꾸거나 다른 모델까지 차단하지 않는다",async()=>{
  for(const status of [400,403,500]) {
    mock.method(globalThis,"fetch",async()=>{requests.push({url:"error",input:{title:"",text:""}});return new Response("",{status})})
    const result=await translateArticleStep({...article,id:"error-"+status})
    assert.equal(result.previewStatus,"failed")
    assert.equal(result.retryAfterSeconds,3600)
    mock.timers.tick(5000)
  }
  assert.equal(requests.length,3)
  assert.equal(usage.length,1)
  assert.equal(usage[0].blockedUntil,null)
})

test("모델별 요청 간격은 각 무료 RPM과 입력 TPM 예산을 지킨다",()=>{
  assert.deepEqual(FREE_TRANSLATION_MODELS.map(item=>getTranslationRequestInterval("small input",item.model)),[5000,5000,13000,13000])
  for(const item of FREE_TRANSLATION_MODELS) {
    assert.ok(60000/getTranslationRequestInterval("small input",item.model)<item.limits.requestsPerMinute)
    assert.ok(getTranslationRequestInterval("a".repeat(49744),item.model)>=15000)
  }
})

test("현황은 모델별 사용량과 총 제한을 함께 표시하고 모든 모델 소진을 반영한다",async()=>{
  usage.push(...FREE_TRANSLATION_MODELS.map(item=>({dateKey:"2026-10-01",model:item.model,requests:item.dailyLimit,nextRequestAt:new Date(),blockedUntil:null})))
  const status=await getTranslationQueueSummary()
  assert.equal(status.dailyLimit,936)
  assert.equal(status.requests,936)
  assert.equal(status.model,null)
  assert.equal(status.retryAfterSeconds,21600)
  assert.deepEqual(status.models.map(item=>item.dailyLimit),[450,450,18,18])
})

test("선별·요약 작업도 한도 오류 후 대체 모델의 결과를 검증해 저장한다",async()=>{
  const tech={...article,category:"developer"}
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length===1 ? new Response("",{status:429}) : curationResponse(true,input)
  })
  await enqueueArticleTranslation(tech)
  await translateArticleStep(tech)
  assert.equal(rows.find(row=>row.kind===CURATION_KIND)?.status,"ready")
  assert.equal((await getListTranslations([tech])).get(tech.id)?.isSummary,true)
  assert.equal(requests.length,2)
})

test("대체 모델 재시도로 60초가 지나도 갱신된 작업 예약을 중복 회수하지 않는다",async()=>{
  let calls=0
  mock.method(globalThis,"fetch",async(_url:string | URL | Request,init?:RequestInit)=>{
    calls++
    mock.timers.tick(45000)
    if(calls===1) return new Response("",{status:429,headers:{"retry-after":"120"}})
    await translateArticleStep(article)
    return successfulResponse(JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text))
  })
  assert.equal((await translateArticleStep(article)).previewStatus,"ready")
  assert.equal(calls,2)
  assert.equal(rows.length,1)
})

test("모델 사용 불가 404는 다음 모델로 전환하며 다음 작업에서 재호출하지 않는다",async()=>{
  mock.method(globalThis,"fetch",async(url:string | URL | Request,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text)
    requests.push({url:String(url),input})
    return requests.length===1 ? new Response(JSON.stringify({error:{message:"This model is no longer available to new users."}}),{status:404}) : successfulResponse(input)
  })
  const result=await translateArticleStep(article)
  assert.equal(result.operation?.outcome,"ready")
  assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
  assert.equal(result.operation?.attempts[0].outcome,"unavailable")
  assert.equal(result.operation?.attempts[0].httpStatus,404)
  assert.match(result.operation?.attempts[0].reason||"",/no longer available/)
  assert.equal(Number(usage[0].blockedUntil)-Date.now(),21600000)
  mock.timers.tick(5000)
  await translateArticleStep(article)
  assert.match(requests[2].url,/gemini-3\.1-flash-lite/)
})

test("실패 로그 정보에는 HTTP 상태·실패 사유·기사별 재시도 대기를 보존하고 키를 숨긴다",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:"API key "+process.env.TRANSLATION_GEMINI_API_KEY+" rejected"}}),{status:403}))
  await enqueueArticleTranslation(article)
  const step=await processTranslationQueueStep()
  assert.equal(step.processed,true)
  assert.equal(step.operation?.outcome,"failed")
  assert.equal(step.operation?.model,FREE_TRANSLATION_MODEL)
  assert.equal(step.operation?.attempts[0].httpStatus,403)
  assert.equal(step.operation?.retryAfterSeconds,3600)
  assert.equal(step.retryAfterSeconds,5)
  assert.match(step.operation?.reason||"",/키 숨김/)
  assert.ok(!JSON.stringify(step).includes(process.env.TRANSLATION_GEMINI_API_KEY!))
})

test("잘린 응답과 JSON 형식 오류를 구분하고 응답 본문을 오류 로그에 노출하지 않는다",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]})))
  assert.match((await translateArticleStep(article)).operation?.reason||"",/MAX_TOKENS/)
  mock.timers.tick(5000)
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"invalid original text"}]}}]})))
  const result=await translateArticleStep({...article,id:"invalid-json"})
  assert.equal(result.operation?.outcome,"failed")
  assert.equal(result.operation?.reason,"번역 응답 JSON 형식 오류")
})

test("앱 일일 한도 도달로 건너뛴 모델과 대체 모델 성공을 작업 결과에 구분한다",async()=>{
  usage.push({dateKey:"2026-10-01",model:FREE_TRANSLATION_MODEL,requests:450,nextRequestAt:new Date(),blockedUntil:null})
  const result=await translateArticleStep(article)
  assert.equal(result.operation?.outcome,"ready")
  assert.equal(result.operation?.attempts[0].outcome,"skipped")
  assert.equal(result.operation?.attempts[0].quota,"앱 RPD")
  assert.equal(result.operation?.attempts[1].outcome,"success")
})

test("모델 확인은 대체 모델에만 한 번씩 실제 요청을 예약하고 기사 큐는 수정하지 않는다",async()=>{
  const result=await checkTranslationModels()
  assert.deepEqual(result.map(item=>item.model),FREE_TRANSLATION_MODELS.slice(1).map(item=>item.model))
  assert.ok(result.every(item=>item.outcome==="success" && /[가-힣]/.test(item.text||"")))
  assert.equal(rows.length,0)
  assert.equal(requests.length,3)
  assert.deepEqual(usage.map(row=>row.requests),[1,1,1])
  const waiting=await checkTranslationModels()
  assert.ok(waiting.every(item=>item.outcome==="skipped"))
  assert.equal(requests.length,3)
})

test("오류 로그는 API 키를 제거하고 출력 길이를 제한한다",()=>{
  process.env.GEMINI_API_KEY="a-second-private-key"
  const result=getTranslationErrorMessage(new Error(process.env.TRANSLATION_GEMINI_API_KEY+"\n"+process.env.GEMINI_API_KEY+" "+"A".repeat(700)))
  assert.equal(result.length,500)
  assert.ok(!result.includes(process.env.TRANSLATION_GEMINI_API_KEY!))
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
    const result=await translateArticleStep(article)
    assert.equal(result.operation?.outcome,"ready")
    assert.equal(result.operation?.attempts[0].outcome,"temporary")
    assert.equal(result.operation?.attempts[0].quota,undefined)
    assert.equal(result.operation?.model,"gemini-3.1-flash-lite")
    assert.equal(Number(usage[0].blockedUntil)-Date.now(),60000)
  })
}

test("모든 모델의 일시적 과부하는 실패 대신 짧은 재시도 대기로 남긴다",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:{message:"High demand"}}),{status:503}))
  const result=await translateArticleStep(article)
  assert.equal(result.previewStatus,"pending")
  assert.equal(result.operation?.outcome,"waiting")
  assert.equal(result.retryAfterSeconds,60)
  assert.ok(result.operation?.attempts.every(item=>item.outcome==="temporary"))
  assert.ok((await getTranslationAvailability(450)).models.every(item=>item.quotaStatus==="api_wait"))
})

test("API 번역에 성공해도 DB 저장이 되지 않으면 저장 성공으로 표시하지 않는다",async()=>{
  const updateMany=prisma.newsTranslation.updateMany.bind(prisma.newsTranslation)
  mock.method(prisma.newsTranslation,"updateMany",async(args:Parameters<typeof updateMany>[0])=>{
    if(args.data.status==="ready") return {count:0}
    return updateMany(args)
  })
  const result=await translateArticleStep(article)
  assert.equal(result.previewStatus,"failed")
  assert.equal(result.operation?.outcome,"failed")
  assert.match(result.operation?.reason||"",/저장하지 못했습니다/)
  assert.equal(rows[0].translatedText,null)
})
