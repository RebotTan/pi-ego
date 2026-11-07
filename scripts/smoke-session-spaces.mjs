/**
 * 真实会话隔离验证：两个 Pi 会话各跑一次浏览动作，落在两个不同的 ego 空间。
 * 证据来自运行时自己的 task-spaces.json（不是纯函数断言）。
 * 运行：node scripts/smoke-session-spaces.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')
const { egoStateDir } = await jiti.import('../src/host/instance.ts')

const tools = new Map()
mod.default({ registerTool: (tool) => tools.set(tool.name, tool), on: () => {} })

const call = async (sessionId, name, args) => {
  const ctx = { sessionManager: { getSessionId: () => sessionId }, ui: { notify: () => {} } }
  const result = await tools.get(name).execute('smoke', args, undefined, undefined, ctx)
  return result.isError ? { error: result.content[0]?.text } : {}
}

const readSpaces = () => {
  try {
    const state = JSON.parse(readFileSync(join(egoStateDir(), 'task-spaces.json'), 'utf8'))
    return state.spaces ?? []
  } catch {
    return []
  }
}

const alpha = await call('session-alpha', 'ego_navigate', { url: 'https://example.com' })
const beta = await call('session-beta', 'ego_navigate', { url: 'https://example.com' })
const spaces = readSpaces()
const names = new Set(spaces.map((space) => space.name))
const withTabs = (name) => spaces.find((space) => space.name === name && (space.targetIds ?? []).length > 0)

const problems = []
if (alpha.error) problems.push(`session-alpha navigate: ${alpha.error}`)
if (beta.error) problems.push(`session-beta navigate: ${beta.error}`)
if (alpha.error || beta.error) {
  // 报告失败即可，不必再看 space。
} else {
  if (!names.has('pi-agent-alpha')) problems.push(`no pi-agent-alpha space; saw ${[...names].join(', ')}`)
  if (!names.has('pi-agent-beta')) problems.push(`no pi-agent-beta space; saw ${[...names].join(', ')}`)
  if (!withTabs('pi-agent-alpha')) problems.push('pi-agent-alpha has no tab')
  if (!withTabs('pi-agent-beta')) problems.push('pi-agent-beta has no tab')
}

console.log('spaces:', [...names].filter((name) => name.startsWith('pi-agent-')).join(', '))
console.log(`problems=${problems.length}`)
for (const problem of problems) console.log(' -', problem)
process.exit(problems.length === 0 ? 0 : 1)