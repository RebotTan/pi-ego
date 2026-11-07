/**
 * 调用任意 ego_* 工具并打印结果：node scripts/smoke-call.mjs <tool> '<json args>'
 * 用于阶段验收（navigate / snapshot / click / fill / screenshot …）。
 */
import { createJiti } from 'jiti'

const [name, rawArgs = '{}'] = process.argv.slice(2)
if (!name) {
  console.error('usage: node scripts/smoke-call.mjs <tool> [json]')
  process.exit(2)
}

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')
const tools = new Map()
mod.default({
  registerTool: (tool) => tools.set(tool.name, tool),
  on: () => {},
})

const tool = tools.get(name)
if (!tool) {
  console.error(`unknown tool: ${name}`)
  process.exit(2)
}
const ctx = {
  sessionManager: { getSessionId: () => 'smoke-session' },
  ui: { notify: (message, level) => console.log(`[notify:${level}]`, message) },
}

try {
  const result = await tool.execute('smoke-call', JSON.parse(rawArgs), undefined, undefined, ctx)
  console.log('isError=', result.isError ?? false)
  for (const part of result.content) {
    if (part.type === 'text') console.log(part.text.slice(0, 4000))
    else console.log(`<${part.type} ${part.mimeType} ${Math.round(part.data.length / 1024)}KB base64>`)
  }
} catch (error) {
  console.error('THREW:', error?.message ?? error)
  process.exitCode = 1
}
process.exit(process.exitCode ?? 0)