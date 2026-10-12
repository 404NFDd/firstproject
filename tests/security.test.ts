import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import nodemailer from "nodemailer"
import { isAuthorizedCron } from "../lib/cron-auth"
import { escapeHtml } from "../lib/html"

const originalSecret = process.env.CRON_SECRET
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

test("Cron은 비밀값이 없거나 다르면 거절하며 두 헤더 형식을 지원한다", () => {
  delete process.env.CRON_SECRET
  assert.equal(isAuthorizedCron(new Headers({ authorization: "Bearer test" })), false)
  process.env.CRON_SECRET = "test-secret"
  assert.equal(isAuthorizedCron(new Headers()), false)
  assert.equal(isAuthorizedCron(new Headers({ "x-cron-secret": "wrong" })), false)
  assert.equal(isAuthorizedCron(new Headers({ "x-cron-secret": "test-secret" })), true)
  assert.equal(isAuthorizedCron(new Headers({ authorization: "Bearer test-secret" })), true)
  process.env.CRON_SECRET = "비밀값"
  assert.equal(isAuthorizedCron(new Headers({ "x-cron-secret": "short" })), false)
})

test("메일에 삽입할 HTML의 특수 문자를 이스케이프한다", () => {
  assert.equal(escapeHtml(`<script a="x">'&</script>`), "&lt;script a=&quot;x&quot;&gt;&#039;&amp;&lt;/script&gt;")
})

test("보안 수정 Nodemailer에서 기존 createTransport/sendMail API가 동작한다", async () => {
  const transporter = nodemailer.createTransport({ jsonTransport: true })
  const result = await transporter.sendMail({ from: "sender@example.com", to: "reader@example.com", subject: "테스트 브리핑", html: "<p>테스트</p>" })
  const message = JSON.parse(result.message.toString())
  assert.equal(message.subject, "테스트 브리핑")
  assert.equal(message.to[0].address, "reader@example.com")
  assert.equal(message.html, "<p>테스트</p>")
})
