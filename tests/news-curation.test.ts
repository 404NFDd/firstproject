import assert from "node:assert/strict"
import { test } from "node:test"
import { isCurationArticle, getCurationHash, validateCurationResult, prepareCurationRequest } from "../lib/news-curation"

const input = { title: "Compiler benchmark", text: "A benchmark of 12 projects measured a 30% reduction in build time. Results depend on the project." }
const result = { selected: true, title: "프로젝트 빌드 시간 변화", summary: "12개 프로젝트 벤치마크에서 빌드 시간이 30% 줄었습니다. 프로젝트에 따라 결과가 달라 실제 환경과 비교해 볼 만한 변화입니다.", reason: "실무 성능 비교", evidence: ["Results depend on the project."] }
test("기술·IT 기사는 선별 대상으로 삼고 일반 뉴스는 기존 정책을 유지한다", () => {
  for (const category of ["developer", "engineering", "ai", "infrastructure", "release", "105"]) assert.equal(isCurationArticle({title:"기사",category}),true)
  assert.equal(isCurationArticle({title:"기사",category:"100"}),false)
  assert.equal(isCurationArticle({title:"기사"}),false)
})
test("요약은 한국어·원문 근거·원문 수치를 검증하고 빈 본문을 거부한다", () => {
  assert.deepEqual(validateCurationResult(result,input),result)
  assert.throws(()=>validateCurationResult({...result,summary:"성능이 99% 향상됐습니다."},input),/수치/)
  assert.throws(()=>validateCurationResult({...result,evidence:["Invented evidence"]},input),/근거/)
  assert.throws(()=>validateCurationResult({...result,summary:"English summary"},input),/한국어/)
  assert.throws(()=>validateCurationResult(result,{...input,text:""}),/근거/)
})
test("제외된 글의 제목·요약은 게시용으로 남기지 않는다", () => {
  const rejected=validateCurationResult({...result,selected:false},input)
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
  assert.equal(request.generationConfig.responseMimeType,"application/json")
})
