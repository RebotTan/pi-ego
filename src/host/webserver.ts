/**
 * Pi 侧的最小 HTTP 宿主：cast-server 的路由处理器本来就是 node http 风格
 * (req, res)，这里只补一个 register() 路由表 + token 鉴权 + 观察页入口。
 * 只监听 127.0.0.1；token 每次启动随机生成，进页面时收进 HttpOnly cookie。
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { RegisterRouteOptions, WebServerLike } from '../types.ts'

export interface LocalWebServer {
  readonly server: WebServerLike
  /** listen 完成后的观察页地址（带 token）；启动失败时 reject。 */
  readonly ready: Promise<string>
  setPage(html: string): void
  close(): void
}

export interface LocalWebServerOptions {
  /** 0 = 随机端口；被占用时也回退到随机端口。 */
  port?: number
  /** 观察页 HTML；/ 或 /index.html 返回它。 */
  page?: string
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

const COOKIE = 'pi-ego-token'

function readToken(req: IncomingMessage, url: URL): string {
  const header = req.headers['x-ego-token']
  if (typeof header === 'string') return header
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery
  const cookies = String(req.headers.cookie ?? '')
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookies)
  if (!match) return ''
  // 畸形 cookie（如 % 未转义）会让 decodeURIComponent 抛 URIError；
  // token 本身是 base64url，无需解码，失败时按原始值比较即可。
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function createLocalWebServer(options: LocalWebServerOptions = {}): LocalWebServer {
  const token = randomBytes(18).toString('base64url')
  const routes = new Map<string, Handler>()
  const http = createServer()
  let page = options.page ?? ''

  const server: WebServerLike = {
    register: (registration: RegisterRouteOptions) => {
      routes.set(registration.path, registration.handler as Handler)
      return () => {
        routes.delete(registration.path)
      }
    },
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const allowed = readToken(req, url) === token

    if ((url.pathname === '/' || url.pathname === '/index.html') && page !== '') {
      if (!allowed) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
      })
return void res.end(page)
    }

    const route = routes.get(url.pathname)
    if (!route) return sendJson(res, 404, { ok: false, error: 'not found' })
    // 未匹配 token 的请求在最外层就挡掉，路由处理器里不再重复判定。
    if (!allowed) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    try {
      await route(req, res)
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: (error as Error).message ?? String(error) })
      else res.end()
    }
  }

  http.on('request', (req, res) => {
    void handle(req, res)
  })

  const bind = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        http.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        http.removeListener('error', onError)
        const address = http.address()
        resolve(typeof address === 'object' && address ? address.port : port)
      }
      http.once('error', onError)
      http.once('listening', onListening)
      http.listen(port, '127.0.0.1')
    })

  const ready = (async (): Promise<string> => {
    let port = options.port ?? 0
    if (port > 0) {
      // 固定端口被别的 Pi 实例占了：退回随机端口，别让观察页拖垮整个扩展。
      port = await bind(port).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error
        return bind(0)
      })
    } else {
      port = await bind(0)
    }
    return `http://127.0.0.1:${port}/?token=${token}`
  })()

  return {
    server,
    ready,
    setPage(html: string) {
      page = html
    },
    close() {
      http.removeAllListeners('request')
      http.close()
    },
  }
}