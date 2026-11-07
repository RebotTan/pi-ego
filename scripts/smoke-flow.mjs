/**
 * 阶段 1 验收流程（单进程，模拟同一 Pi 会话内的连续工具调用）：
 * navigate → snapshot → 截图 → 注入表单 → fill → click → 读回。
 * 运行：node scripts/smoke-flow.mjs
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')

const tools = new Map()
mod.default({
  registerTool: (tool) => tools.set(tool.name, tool),
  on: () => {},
})

const ctx = {
  sessionManager: { getSessionId: () => 'smoke-session' },
  ui: { notify: (message, level) => console.log(`[notify:${level}]`, message) },
}

const failures = []
async function call(name, args = {}) {
  const tool = tools.get(name)
  try {
    const result = await tool.execute(`smoke-${name}`, args, undefined, undefined, ctx)
    const text = result.content.find((part) => part.type === 'text')?.text ?? ''
    const images = result.content.filter((part) => part.type === 'image').length
    console.log(`\n### ${name} isError=${result.isError ?? false} images=${images}`)
    console.log(text.slice(0, 400))
    if (result.isError) failures.push(name)
    return { result, text, images }
  } catch (error) {
    console.log(`\n### ${name} THREW: ${error?.message ?? error}`)
    failures.push(name)
    return { result: undefined, text: '', images: 0 }
  }
}

await call('ego_navigate', { url: 'https://example.com' })
await call('ego_snapshot')

const shot = await call('ego_screenshot', {})
if (shot.images !== 1) failures.push('screenshot:image-content')

await call('ego_js', {
  expression:
    "(()=>{document.body.insertAdjacentHTML('afterbegin','<input id=pi-smoke><button id=pi-btn>go</button>');" +
    "document.querySelector('#pi-btn').addEventListener('click',()=>{document.title='clicked'});" +
    "return document.querySelector('#pi-smoke')!==null})()",
})
await call('ego_fill', { selector: '#pi-smoke', text: 'hello pi' })
await call('ego_click', { selector: '#pi-btn' })
const read = await call('ego_js', { expression: "document.querySelector('#pi-smoke').value" })
if (!read.text.includes('hello pi')) failures.push('fill:value-not-readback')

console.log(`\nfailures=${failures.length ? failures.join(',') : 'none'}`)
process.exit(failures.length === 0 ? 0 : 1)