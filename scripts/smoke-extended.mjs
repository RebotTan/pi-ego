/**
 * 扩展冒烟：覆盖 smoke-flow 之外的工具（读类 / 交互类 / 管理类 / 错误路径）。
 * 运行：node scripts/smoke-extended.mjs
 * 不依赖任何外部站点之外的资源；不上传/下载/不 flush 认证。
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const mod = await jiti.import('../src/index.ts')

const tools = new Map()
mod.default({ registerTool: (tool) => tools.set(tool.name, tool), on: () => {} })
const ctx = {
  sessionManager: { getSessionId: () => 'smoke-extended' },
  ui: { notify: (m, l) => console.log(`[notify:${l}]`, m) },
}

const failures = []
const warnings = []
async function call(name, args = {}, opts = {}) {
  const tool = tools.get(name)
  if (!tool) { failures.push(`${name}:not-registered`); return { text: '', isError: true } }
  let timer
  try {
    const result = await Promise.race([
      tool.execute(`smoke-${name}`, args, undefined, undefined, ctx),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout 30s')), 30_000) }),
    ])
    clearTimeout(timer)
    const text = result.content.find((p) => p.type === 'text')?.text ?? ''
    const images = result.content.filter((p) => p.type === 'image').length
    const expectError = opts.expectError === true
    const bad = Boolean(result.isError) !== expectError
    console.log(`\n### ${name} isError=${result.isError ?? false} images=${images} ${bad ? '<<< UNEXPECTED' : ''}`)
    console.log(text.slice(0, 220).replace(/\n+/g, ' '))
    if (bad) failures.push(`${name}:isError=${result.isError ?? false}`)
    if (opts.check && !opts.check(text)) failures.push(`${name}:check-failed`)
    return { text, isError: Boolean(result.isError), result }
  } catch (error) {
    clearTimeout(timer)
    console.log(`\n### ${name} THREW: ${error?.message ?? error}`)
    if (opts.expectError !== true) failures.push(`${name}:threw`)
    return { text: '', isError: true }
  }
}

await call('ego_navigate', { url: 'https://example.com' })
await call('ego_page_info', {}, { check: (t) => t.includes('example.com') })
await call('ego_tabs', {}, { check: (t) => /tab|target/i.test(t) })
await call('ego_snapshot', {}, { check: (t) => t.length > 20 })
await call('ego_wait', { ms: 120 })

// 造一个含 select/checkbox/hover 目标的测试页
await call('ego_js', {
  expression: `(()=>{document.body.insertAdjacentHTML('afterbegin',
  '<select id=sel><option value=a>A</option><option value=b>B</option></select>'+
  '<input id=cb type=checkbox><div id=hov style="width:80px;height:40px;background:#ccc">hover me</div>'+
  '<input id=keyin>');return true})()`,
}, { check: (t) => t.includes('true') })
await call('ego_wait_for_selector', { selector: '#sel' })
await call('ego_wait_for_url', { pattern: 'example.com' })
await call('ego_select', { selector: '#sel', value: 'b' })
await call('ego_check', { selector: '#cb', checked: true })
await call('ego_hover', { selector: '#hov' })
await call('ego_scroll', { deltaY: 200 })
await call('ego_read_element', { selector: '#sel', what: 'value' }, { check: (t) => t.includes('"b"') })
await call('ego_read_element', { selector: '#cb', what: 'enabled' })
await call('ego_key', { key: 'Enter' })
await call('ego_cdp', { method: 'Browser.getVersion' }, { check: (t) => /product|protocolVersion/.test(t) })
await call('ego_http', { url: 'https://example.com/' }, { check: (t) => /Example Domain|status/i.test(t) })
await call('ego_help', {}, { check: (t) => t.length > 50 })
await call('ego_doctor', {})
await call('ego_space_open', { name: 'smoke-space-a' }, { check: (t) => t.length > 0 })
await call('ego_space_close', { name: 'smoke-space-a' }, { check: (t) => t.length > 0 })
const CLI = "console.log('@@DSH_RESULT@@' + JSON.stringify({ ok: true, sum: 1 + 1 }))"
await call('ego_cli', { script: CLI }, { check: (t) => t.includes('"sum": 2') })
await call('ego_script', { script: CLI }, { check: (t) => t.includes('"sum": 2') })
// 错误路径：不存在的选择器必须报错但进程不崩
await call('ego_fill', { selector: '#does-not-exist', text: 'x' }, { expectError: true })

console.log(`\nfailures=${failures.length ? failures.join(', ') : 'none'}`)
if (warnings.length) console.log(`warnings=${warnings.join(', ')}`)
process.exit(failures.length === 0 ? 0 : 1)
