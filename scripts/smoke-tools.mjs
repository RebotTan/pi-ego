/**
 * 冒烟：用假的 ExtensionAPI 加载扩展，确认 35 个 ego_* 工具都注册成功，
 * 且参数被转成合法的 JSON Schema（Pi 不接受 DSH 的 required 字段形状）。
 * 运行：node scripts/smoke-tools.mjs
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')

const tools = new Map()
const events = []
const pi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  on: (event) => events.push(event),
}
mod.default(pi)

const problems = []
for (const [name, tool] of tools) {
  if (tool.parameters?.type !== 'object') problems.push(`${name}: parameters is not an object schema`)
  const walk = (schema, where) => {
    if (schema === null || typeof schema !== 'object') return
    if ('required' in schema && !Array.isArray(schema.required)) {
      problems.push(`${name}.${where}: required is not an array`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, `${where}.${key}`)
    if (schema.items) walk(schema.items, `${where}[]`)
  }
  walk(tool.parameters, 'parameters')
  if (typeof tool.execute !== 'function') problems.push(`${name}: no execute`)
}

const names = [...tools.keys()]
console.log(`registered=${names.length}`)
console.log(names.join(','))
console.log(`events=${events.join(',')}`)
console.log(`problems=${problems.length}`)
for (const problem of problems.slice(0, 20)) console.log(' -', problem)
process.exit(problems.length === 0 && names.length === 35 ? 0 : 1)