/**
 * Pi 扩展入口：把 DSH 插件（src/plugin.ts）注册的 ego_* 工具接到 Pi 的
 * registerTool 上，并提供 DSH 宿主服务的等价物（subprocess / effect / notify）。
 *
 * 工具定义仍是 src/plugin.ts 里的 DSH 形状；这里只做 schema 与结果转换，
 * 不改动浏览器执行路径。
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { readFile, stat } from 'node:fs/promises'
import { apply } from './plugin.ts'
import { toJsonSchema, type HostTool } from './host/define-tool.ts'
import { nodeSubprocess } from './host/subprocess.ts'
import type { LoggerLike } from './types.ts'
import type { EgoContext, ToolExec } from './types.ts'
import { createLocalWebServer } from './host/webserver.ts'
import { OBSERVE_PAGE } from './host/panel-html.ts'
import { egoStateDir } from './host/instance.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Pi 内置工具的输出上限：50KB / 2000 行；这里按字节截断。 */
const MAX_TEXT_BYTES = 50_000
/** 只有确实像图片、且未超过该大小的文件才内联给模型。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export default function egoBrowserExtension(pi: ExtensionAPI): void {
  const disposers: Array<() => void> = []
  let currentCtx: ExtensionContext | undefined

  const logger: LoggerLike = Object.assign(
    (_id: string): LoggerLike | undefined => logger,
    {
      info: (message: unknown, ...rest: unknown[]) => console.error('[ego]', message, ...rest),
      warn: (message: unknown, ...rest: unknown[]) => console.error('[ego] warn', message, ...rest),
      error: (message: unknown, ...rest: unknown[]) => console.error('[ego] error', message, ...rest),
    },
  )
const observe = createLocalWebServer({
    port: Number(process.env.PI_EGO_PORT ?? 0) || 0,
    page: OBSERVE_PAGE,
  })
  disposers.push(() => observe.close())
  void observe.ready
    .then((url) => {
      try {
        writeFileSync(
          join(egoStateDir(), 'observe.json'),
          JSON.stringify({ url, pid: process.pid, startedAt: Date.now() }, null, 2),
        )
      } catch {
        /* 状态目录不可写不影响工具本身 */
      }
      logger.info?.(`观察页：${url}`)
      currentCtx?.ui.notify(`ego 观察页：${url}`, 'info')
      return url
    })
    .catch((error: Error) => logger.warn?.(`观察页启动失败：${error.message}`))

  const host: EgoContext = {
    subprocess: nodeSubprocess,
    tools: {
      register: (tool) => registerPiTool(pi, tool as HostTool, (ctx) => {
        currentCtx = ctx
      }),
    },
    // DSH 的 effect 会立即执行注册函数并保留其清理函数；这里照做。
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
    },
// 观察页主机：127.0.0.1 + 随机 token；cast-server 的路由由 inject 挂上去。
    webServer: observe.server,
    get: (name) => {
      if (name === 'webServer') return observe.server
      // 最外层已经校验过 token，路由处理器里再判一次即可恒真。
      if (name === 'trustRequest') return () => true
      return undefined
    },
    inject: (services, fn) => {
      if (!services.includes('webServer')) return
      void observe.ready.then(() => fn(host)).catch(() => {})
    },
    notify: (message, level) => {
      currentCtx?.ui.notify(message, level)
    },
    logger,
  }

  apply(host, {})

  pi.on('session_shutdown', (event) => {
    // 切会话（new/resume/fork）不能停浏览器：另一个会话可能正在用。
    if (event.reason !== 'quit' && event.reason !== 'reload') return
    // 不 splice：首次退出可能因别的实例还在而跳过 --stop，重复触发要能补上。
    for (const dispose of [...disposers]) {
      try {
        dispose()
      } catch {
        /* teardown must never throw */
      }
    }
  })
}

function registerPiTool(
  pi: ExtensionAPI,
  tool: HostTool,
  onRun: (ctx: ExtensionContext) => void,
): () => void {
  const definition = {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.parameters),
    async execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      onRun(ctx)
      const exec: ToolExec = {
        callId: toolCallId,
        name: tool.name,
        arguments: (params ?? {}) as Record<string, unknown>,
        // Pi 的工具信号在极少数情况下为 undefined；给个永不中止的占位。
        signal: signal ?? new AbortController().signal,
        agent: { session: { id: safeSessionId(ctx) } },
      }
      const value = await tool.execute((params ?? {}) as Record<string, unknown>, exec)
      return toToolResult(value)
    },
  }
  // Pi 的 ToolDefinition 泛型按 schema 推导参数类型，运行期形状与这里一致。
  pi.registerTool(definition as never)
  // Pi 没有 unregisterTool；清理交给进程退出。
  return () => {}
}

function safeSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId() || undefined
  } catch {
    return undefined
  }
}

type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

async function toToolResult(value: unknown): Promise<{
  content: ToolContent[]
  details: Record<string, unknown>
  isError?: boolean
}> {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (record.ok === false) {
    const message =
      typeof record.error === 'string' ? record.error : truncate(JSON.stringify(record))
    return { content: [{ type: 'text', text: message }], details: record, isError: true }
  }

  const content: ToolContent[] = []
  const image = await inlineImage(record.path)
  if (image !== undefined) content.push(image)
  const text =
    typeof record.text === 'string' ? record.text : JSON.stringify(record, null, 2) ?? 'ok'
  content.push({ type: 'text', text: truncate(text) })
  return { content, details: record }
}

/** 本地 PNG/JPEG 直接内联，模型无需再调用一次读文件工具。 */
async function inlineImage(path: unknown): Promise<ToolContent | undefined> {
  if (typeof path !== 'string' || path === '') return undefined
  const mimeType = /\.png$/i.test(path)
    ? 'image/png'
    : /\.(jpe?g)$/i.test(path)
      ? 'image/jpeg'
      : undefined
  if (mimeType === undefined) return undefined
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return undefined
    return { type: 'image', data: (await readFile(path)).toString('base64'), mimeType }
  } catch {
    return undefined
  }
}

function truncate(text: string): string {
  const bytes = Buffer.byteLength(text)
  if (bytes <= MAX_TEXT_BYTES) return text
  const head = Buffer.from(text).subarray(0, MAX_TEXT_BYTES).toString('utf8')
  return `${head}\n\n[Output truncated: ${bytes} bytes total, showing ${MAX_TEXT_BYTES}.]`
}