/**
 * 阶段 3 验收：观察页服务真的起来了，且未带 token 的请求被挡在 401。
 * 运行：node scripts/smoke-observe.mjs
 */
import { createJiti } from 'jiti'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')
const { egoStateDir } = await jiti.import('../src/host/instance.ts')

const stateFile = join(egoStateDir(), 'observe.json')
try {
  rmSync(stateFile)
} catch {
  /* 首次运行没有旧状态 */
}

mod.default({
  registerTool: () => {},
  on: () => {},
})

const problems = []

async function waitForUrl(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const { url } = JSON.parse(readFileSync(stateFile, 'utf8'))
      if (url) return url
    } catch {
      /* 还没写出来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

const url = await waitForUrl()
if (!url) {
  console.log('observe.json 未写出')
  process.exit(1)
}
const parsed = new URL(url)
const origin = parsed.origin
const token = parsed.searchParams.get('token')

const page = await fetch(url)
const html = await page.text()
if (page.status !== 200 || !html.includes('观察页')) problems.push(`page:${page.status}`)

const anonymous = await fetch(`${origin}/api/ego/health`)
if (anonymous.status !== 401) problems.push(`anonymous-health:${anonymous.status}`)

const authorized = await fetch(`${origin}/api/ego/health`, { headers: { 'x-ego-token': token } })
if (authorized.status !== 200) problems.push(`authorized-health:${authorized.status}`)
const body = await authorized.json().catch(() => ({}))
if (!('ok' in body) && !('workerOk' in body)) problems.push('health:shape')

console.log(`url=${url}`)
console.log(`page=${page.status} anonymous=${anonymous.status} authorized=${authorized.status}`)
console.log(`problems=${problems.length ? problems.join(',') : 0}`)
process.exit(problems.length === 0 ? 0 : 1)