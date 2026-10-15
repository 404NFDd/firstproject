import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NewsSummary } from "../components/news-summary"
import type { CurationResult } from "../lib/news-curation"

test("한국어 정리는 강조·출처 링크·하위 항목·표를 표시하고 HTML은 실행하지 않는다", () => {
  const summary: CurationResult = { selected: true, title: "평가 결과", summary: "한국어 요약입니다.",
    highlights: ["**성능 개선**을 공개했습니다.", "[공개 평가](https://example.com/evals)를 확인할 수 있습니다.", "<script>alert(1)</script>는 자료입니다."],
    sections: [{ heading: "평가 조건", bullets: [{ text: "여러 항목을 비교했습니다.", details: ["표본이 제한돼 있습니다.", "[안전하지 않은 링크](javascript:alert)"] }],
      table: { headers: ["모델", "시간"], rows: [["테스트 모델", "38.8ms"]] } }], reason: "새로운 소식", evidence: [] }
  const html = renderToStaticMarkup(createElement(NewsSummary, { summary }))
  assert.match(html, /<strong[^>]*>성능 개선<\/strong>/)
  assert.match(html, /href="https:\/\/example.com\/evals"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /<h2[^>]*>평가 조건<\/h2>/)
  assert.match(html, /표본이 제한돼 있습니다/)
  assert.match(html, /<table[\s\S]*38.8ms[\s\S]*<\/table>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script|href="javascript:/)
})
