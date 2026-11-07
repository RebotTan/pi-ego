/**
 * 端到端冒烟：真实调用 ego_status，走 Pi 工具定义 → node 子进程 → ego runtime。
 * 运行：node scripts/smoke-status.mjs
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')

const tools = new Map()
mod.default({
  registerTool: (tool) => tools.set(tool.name, tool),
  on: () => {},
})

const tool = tools.get('ego_status')
const ctx = {
  sessionManager: { getSessionId: () => 'smoke-session' },
  ui: { notify: (message, level) => console.log(`[notify:${level}]`, message) },
}

try {
  const result = await tool.execute('smoke-1', {}, undefined, undefined, ctx)
  console.log('isError=', result.isError ?? false)
  for (const part of result.content) {
    console.log(part.type === 'text' ? part.text.slice(0, 2000) : `<${part.type} ${part.mimeType}>`)
  }
} catch (error) {
  console.error('THREW:', error?.message ?? error)
  process.exitCode = 1
}
process.exit(process.exitCode ?? 0)