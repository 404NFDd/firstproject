import { timingSafeEqual } from "node:crypto"

// 시크릿이 없으면 자동 작업을 허용하지 않는다.
export function isAuthorizedCron(headers: Headers): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const authorization = headers.get("authorization")
  const actual = headers.get("x-cron-secret") ||
    (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null)
  if (!actual) return false

  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
