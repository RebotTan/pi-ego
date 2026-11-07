import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalWebServer, type LocalWebServer } from '../src/host/webserver.ts'

const PAGE = '<!doctype html><html><body>observe</body></html>'

let server: LocalWebServer | undefined
afterEach(() => {
  server?.close()
  server = undefined
})

async function start(): Promise<{ url: string; token: string; base: string }> {
  server = createLocalWebServer({ page: PAGE })
  const url = await server.ready
  const parsed = new URL(url)
  const token = parsed.searchParams.get('token') ?? ''
  return { url, token, base: `${parsed.protocol}//${parsed.host}` }
}

describe('createLocalWebServer', () => {
  it('监听 127.0.0.1 并给出带 token 的地址', async () => {
    const { url, token } = await start()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/)
    expect(token.length).toBeGreaterThan(16)
  })

  it('没有 token 时 401，带 token 时返回页面并写入 HttpOnly cookie', async () => {
    const { base, token } = await start()
    const anonymous = await fetch(`${base}/`)
    expect(anonymous.status).toBe(401)

    const authorized = await fetch(`${base}/?token=${token}`)
    expect(authorized.status).toBe(200)
    expect(await authorized.text()).toBe(PAGE)
    expect(authorized.headers.get('set-cookie')).toContain('pi-ego-token=')
    expect(authorized.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('注册的路由同样受 token 保护，未注册路径 404', async () => {
    const { base, token } = await start()
    server!.server.register?.({
      kind: 'http',
      path: '/api/ping',
      handler: (_req, res) => {
        ;(res as ServerResponse).writeHead(200, { 'content-type': 'application/json' })
        ;(res as ServerResponse).end('{"ok":true}')
      },
    })

    const blocked = await fetch(`${base}/api/ping`)
    expect(blocked.status).toBe(401)

    const allowed = await fetch(`${base}/api/ping?token=${token}`)
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({ ok: true })

    const missing = await fetch(`${base}/api/nope?token=${token}`)
    expect(missing.status).toBe(404)
  })

  it('x-ego-token 头也能通过鉴权', async () => {
    const { base, token } = await start()
    server!.server.register?.({
      kind: 'http',
      path: '/api/echo',
      handler: (req, res) => {
        ;(res as ServerResponse).writeHead(200, { 'content-type': 'text/plain' })
        ;(res as ServerResponse).end((req as IncomingMessage).headers['x-ego-token'] ?? '')
      },
    })
    const res = await fetch(`${base}/api/echo`, { headers: { 'x-ego-token': token } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(token)
  })
})