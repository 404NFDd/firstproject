import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { join } from "node:path"

const resolveModule = createRequire(join(process.cwd(), "package.json"))
const mode = process.argv[2]
if (mode !== "dev" && mode !== "start") throw new Error("dev 또는 start 실행 모드가 필요합니다.")
const worker = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts/summary-worker.ts")], { stdio: "inherit" })
const web = spawn(process.execPath, [resolveModule.resolve("next/dist/bin/next"), mode, ...process.argv.slice(3)], { stdio: "inherit" })
let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  for (const child of [worker, web]) {
    if (child.exitCode === null && child.pid) {
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      else child.kill("SIGTERM")
    }
  }
  process.exitCode = code
}
web.once("exit", (code) => stop(code ?? 0))
worker.once("exit", (code) => { if (!stopping && code) stop(code) })
process.once("SIGINT", () => stop(0))
process.once("SIGTERM", () => stop(0))
