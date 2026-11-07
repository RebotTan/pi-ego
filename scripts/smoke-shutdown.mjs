/**
 * 验证退出清理的所有权：有另一个存活 Pi 时不 --stop 共享浏览器，
 * 最后一个退出时才停。
 * 运行：node scripts/smoke-shutdown.mjs
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')
const { egoStateDir, readBrowserPid } = await jiti.import('../src/host/instance.ts')

const tools = new Map()
const handlers = new Map()
mod.default({
  registerTool: (tool) => tools.set(tool.name, tool),
  on: (event, handler) => handlers.set(event, handler),
})
const shutdown = handlers.get('session_shutdown')
if (!shutdown) {
  console.error('no session_shutdown handler registered')
  process.exit(2)
}

const ctx = {
  sessionManager: { getSessionId: () => 'smoke-session' },
  ui: { notify: () => {} },
}
const problems = []
const stateDir = egoStateDir()
const foreignUser = join(stateDir, 'users', `${process.ppid}.json`)

const call = async (name, args) => {
  const result = await tools.get(name).execute('smoke', args, undefined, undefined, ctx)
  return result.content.find((part) => part.type === 'text')?.text ?? ''
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 从干净状态开始：上一轮可能留下半关的后备浏览器。
const { spawnSync } = await import('node:child_process')
spawnSync(process.execPath, ['runtime/ego-linux/bin/ego-browser.mjs', '--stop'], { stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 1500))

await call('ego_navigate', { url: 'https://example.com' })
const pid = readBrowserPid()
if (!pid || !alive(pid)) problems.push('browser did not start')

// 另一个 Pi 还活着：退出本进程不能关浏览器。
writeFileSync(foreignUser, JSON.stringify({ pid: process.ppid }))
shutdown({ type: 'session_shutdown', reason: 'quit' })
await new Promise((resolve) => setTimeout(resolve, 3000))
if (pid && !alive(pid)) problems.push('browser was stopped while another Pi was alive')

// 它离开了：本进程现在有权停。
rmSync(foreignUser, { force: true })
shutdown({ type: 'session_shutdown', reason: 'quit' })
for (const wait of [1000, 5000]) {
  await new Promise((resolve) => setTimeout(resolve, wait))
  const { readdirSync } = await import('node:fs')
  console.log('pid', pid, 'alive', alive(pid), 'users', readdirSync(join(stateDir, 'users')))
}
if (pid && alive(pid)) {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['runtime/ego-linux/bin/ego-browser.mjs', '--stop'], { encoding: 'utf8', timeout: 20000 })
  console.log('manual stop:', r.status, (r.stdout || '').trim().slice(0, 200))
  await new Promise((resolve) => setTimeout(resolve, 3000))
  if (alive(pid)) problems.push('browser still running after last Pi exited')
}

console.log(`problems=${problems.length}`)
for (const problem of problems) console.log(' -', problem)
process.exit(problems.length === 0 ? 0 : 1)