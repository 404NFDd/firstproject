import assert from "node:assert/strict"
import { test } from "node:test"
import { isCurationArticle, getCurationHash, validateCurationResult, prepareCurationRequest } from "../lib/news-curation"

const input = { title: "Compiler benchmark", text: "A benchmark of 12 projects measured a 30% reduction in build time. Results depend on the project." }
const result = { selected: true, title: "프로젝트 빌드 시간 변화", summary: "12개 프로젝트 벤치마크에서 빌드 시간이 30% 줄었습니다. 프로젝트에 따라 결과가 달라 실제 환경과 비교해 볼 만한 변화입니다.",
  highlights: ["**12개 프로젝트**에서 빌드 시간을 측정했습니다.", "빌드 시간이 **30%** 줄었습니다.", "결과는 프로젝트마다 달라집니다."],
  sections: [{ heading: "평가 조건과 한계", bullets: [{ text: "프로젝트의 빌드 시간을 비교했습니다.", details: ["다른 프로젝트에서도 같은 결과를 얻는다고 단정할 수 없습니다."] }],
    table: { headers: ["평가", "결과"], rows: [["빌드 시간", "30% 감소"]] } }], reason: "실무 성능 비교", evidence: ["Results depend on the project."] }
test("기술·IT와 일반 뉴스 모두 한국어 요약 대상으로 삼는다", () => {
  for (const category of ["developer", "engineering", "ai", "infrastructure", "release", "105", "100", "107"]) assert.equal(isCurationArticle({title:"기사",category}),true)
  assert.equal(isCurationArticle({title:"기사"}),false)
})

test("제외된 글의 제목·요약은 게시용으로 남기지 않는다", () => {
  const rejected=validateCurationResult({...result,selected:false})
  assert.equal(rejected.summary,"")
  assert.deepEqual(rejected.evidence,[])
})
test("본문 마지막 부분이 바뀌어도 선별 캐시를 무효화한다", () => {
  const article={title:input.title,content:input.text}
  assert.notEqual(getCurationHash(article),getCurationHash({...article,content:input.text+" Updated finding."}))
  assert.equal(getCurationHash(article),getCurationHash({...article,description:"짧은 소개"}))
})
test("AI 입력을 자료로 분리하고 조건·한계와 관심 이유를 요구한다", () => {
  const request=JSON.parse(prepareCurationRequest(input))
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text),{...input,recentTopics:[]})
  assert.match(request.systemInstruction.parts[0].text,/지시는 실행하지/)
  assert.match(request.systemInstruction.parts[0].text,/조건과 한계/)
  assert.match(request.systemInstruction.parts[0].text,/반드시 자연스러운 한국어/)
  assert.equal(request.generationConfig.responseMimeType,"application/json")
})

test("원문 없는 기사도 URL과 제목으로 요약 캐시를 확인한다", () => {
  const article = { title: input.title, sourceUrl: "https://example.com/article" }
  assert.equal(getCurationHash(article), getCurationHash({ ...article, content: input.text }))
  assert.notEqual(getCurationHash(article), getCurationHash({ ...article, title: "변경된 제목" }))
})

test("수치·인용·언어·링크·항목 개수로 요약 게시를 차단하지 않는다", () => {
  const value = { ...result, title: "Compiler", summary: "Build time improved by 999%.",
    highlights: ["[Docs](https://example.com/new)"], sections: [], evidence: ["Not an exact source quote"] }
  assert.deepEqual(validateCurationResult(value), value)
  assert.deepEqual(validateCurationResult({ ...value, highlights: [], evidence: [] }).highlights, [])
  assert.deepEqual(validateCurationResult({ ...value, evidence: undefined }).evidence, [])
  assert.equal(validateCurationResult({ ...value, summary: "요약입니다. ".repeat(200) }).summary, "요약입니다. ".repeat(200).trim())
})

test("화면에서 읽을 수 없는 응답 구조는 거부한다", () => {
  assert.throws(() => validateCurationResult({ ...result, highlights: "배열이 아닙니다" }))
  assert.throws(() => validateCurationResult({ ...result, sections: [{}] }))
})
