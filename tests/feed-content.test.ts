import assert from "node:assert/strict"
import { test } from "node:test"
import { feedContentText, sourceContentText, supportsArticleContent } from "../lib/feed-content"

test("피드 본문의 문단·코드·목록을 보존하고 스크립트와 화면 조작 요소는 제외한다", () => {
  const text = feedContentText('<p>첫 문단 &amp; 설명</p><script>secret</script><p>두 번째 문단</p><pre>if (x &lt; 3) {\n  run()\n}</pre><ul><li>항목</li></ul><button>복사</button>')!
  assert.match(text, /첫 문단 & 설명\n\n두 번째 문단/)
  assert.match(text, /if \(x < 3\) \{\n  run\(\)\n\}/)
  assert.match(text, /- 항목/)
  assert.doesNotMatch(text, /secret|복사/)
})

test("Hugging Face는 기사 영역만 사용하고 추천 카드와 위젯을 제외한다", () => {
  const html = '<nav>로그인</nav><article>추천 저장소</article><div class="prose blog-content"><h2>평가 방법</h2><p>실제 연구 내용</p><div class="not-prose">공유 위젯</div></div><footer>댓글</footer>'
  assert.equal(sourceContentText("hugging-face", html), "평가 방법\n\n실제 연구 내용")
  assert.equal(sourceContentText("hugging-face", '<article>추천 카드만 있음</article>'), undefined)
})

test("Node.js는 main의 실제 본문을 사용하고 숨김 아이콘을 제외한다", () => {
  assert.equal(sourceContentText("nodejs", '<main id="main"><h1>Node.js 출시</h1><div aria-hidden="true">아이콘</div><p>변경 사항</p></main><footer>관련 링크</footer>'), "Node.js 출시\n\n변경 사항")
})

test("원문 요청은 확인된 공식 HTTPS 도메인과 기사 경로만 허용한다", () => {
  assert.equal(supportsArticleContent("hugging-face", "https://huggingface.co/blog/open-tts-leaderboard"), true)
  assert.equal(supportsArticleContent("nodejs", "https://nodejs.org/en/blog/release/v22"), true)
  for (const url of ["http://huggingface.co/blog/x", "https://huggingface.co.evil.test/blog/x", "https://huggingface.co/api/x", "https://user:pass@huggingface.co/blog/x", "https://huggingface.co:9000/blog/x", "http://127.0.0.1/"]) {
    assert.equal(supportsArticleContent("hugging-face", url), false)
  }
})

test("확인한 스택의 기사 영역만 추출하고 메뉴·작성자·댓글을 제외한다", () => {
  const fixtures = [
    ["nextjs", '<nav>메뉴</nav><div class="next-prose"><p>보안 수정 내용</p></div><aside>추천</aside>'],
    ["python", '<article class="prose"><header class="not-prose">작성자</header><div><p>보안 수정 내용</p></div><footer>이전 글</footer></article>'],
    ["java", '<h1>제목</h1><div class="ArticlePage-hash123-content"><iframe>영상</iframe><p>보안 수정 내용</p></div><footer>댓글</footer>'],
    ["mysql", '<main><h1>제목</h1><div class="post-content"><p>보안 수정 내용</p></div><aside>광고</aside></main>'],
  ] as const
  for (const [source, html] of fixtures) {
    assert.equal(sourceContentText(source, html), "보안 수정 내용")
    assert.equal(sourceContentText(source, "<main><p>메뉴와 제목만 있는 페이지</p></main>"), undefined)
  }
})

test("새 스택의 본문 보강은 공식 HTTPS 기사 경로로 제한한다", () => {
  const allowed = [
    ["nextjs", "https://nextjs.org/blog/security-update"],
    ["python", "https://blog.python.org/2026/10/release/"],
    ["java", "https://inside.java/2026/10/01/release/"],
    ["mysql", "https://blogs.oracle.com/mysql/release"],
  ] as const
  for (const [source, address] of allowed) {
    assert.equal(supportsArticleContent(source, address), true)
    const url = new URL(address)
    for (const invalid of [address.replace("https:", "http:"), address.replace(url.hostname, url.hostname + ".evil.test"), address.replace("https://", "https://user:pass@"), address.replace(url.hostname, url.hostname + ":9000"), url.origin + "/account/profile"]) {
      assert.equal(supportsArticleContent(source, invalid), false)
    }
  }
})

test("코드 복사 위젯에서도 설치 명령과 들여쓰기를 보존한다", () => {
  const html = '<div class="next-prose"><p>설치 방법</p><div class="not-prose"><span>Terminal</span><button>복사</button><pre>npm install next@16.3.8\n  --save</pre></div><div class="not-prose">공유 위젯</div></div>'
  const content = sourceContentText("nextjs", html)!
  assert.match(content, /설치 방법/)
  assert.match(content, /npm install next@16\.3\.8\n  --save/)
  assert.doesNotMatch(content, /Terminal|복사|공유 위젯/)
})
