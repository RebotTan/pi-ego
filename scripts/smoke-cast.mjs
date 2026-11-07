/**
 * 阶段 3 验收（实况）：打开真实页面后，观察页 SSE 至少吐出一帧 JPEG。
 * 运行：node scripts/smoke-cast.mjs
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

const tools = new Map()
mod.default({
  registerTool: (tool) => tools.set(tool.name, tool),
  on: () => {},
})
const ctx = {
  sessionManager: { getSessionId: () => 'smoke-cast' },
  ui: { notify: () => {} },
}

const problems = []
async function call(name, args = {}) {
  const tool = tools.get(name)
  const result = await tool.execute(`smoke-${name}`, args, undefined, undefined, ctx)
  const text = result.content.find((part) => part.type === 'text')?.text ?? ''
  if (result.isError) problems.push(`${name}:${text.slice(0, 120)}`)
  return text
}

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

await call('ego_navigate', { url: 'https://example.com' })
const url = await waitForUrl()
if (!url) {
  console.log('observe.json 未写出')
  process.exit(1)
}

// worker 只在有 watcher 时采集：先挑目标页 watch/start。
const endpoint = new URL(url)
const token = endpoint.searchParams.get('token')
const spaces = await fetch(`${endpoint.origin}/api/ego/spaces?token=${token}`).then((r) => r.json())
const target = (spaces.spaces?.find((s) => s.active) || spaces.spaces?.[0])?.targetId
if (!target) problems.push('spaces:no-target')
const started = await fetch(`${endpoint.origin}/api/ego/watch/start?token=${token}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: 'smoke-cast', targetId: target }),
}).then((r) => r.json())
if (!started.ok) problems.push(`watch:${started.error ?? 'failed'}`)
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 30_000)
let frames = 0
let firstFrameBytes = 0
try {
const parsed = new URL(url)
  const tok = parsed.searchParams.get("token")
  const stream = await fetch(`${parsed.origin}/api/ego/stream?token=${tok}`, {
    signal: controller.signal,
})
  if (stream.status !== 200) problems.push(`stream:${stream.status}`)
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (frames < 2) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      if (chunk.includes('event: frame')) {
        const data = chunk.split('\ndata: ')[1] ?? ''
        if (frames === 0) firstFrameBytes = data.length
        frames += 1
      }
    }
  }
  await reader.cancel().catch(() => {})
} catch (error) {
  if (error?.name !== 'AbortError') problems.push(`stream-threw:${error?.message ?? error}`)
} finally {
  clearTimeout(timer)
}

if (frames === 0) problems.push('stream:no-frames')
if (frames > 0 && firstFrameBytes < 1000) problems.push(`frame:too-small:${firstFrameBytes}`)

console.log(`frames=${frames} firstFrameBytes=${firstFrameBytes}`)
console.log(`problems=${problems.length ? problems.join(',') : 0}`)
process.exit(problems.length === 0 ? 0 : 1)