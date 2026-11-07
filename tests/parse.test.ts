import { describe, expect, it } from 'vitest'
import {
  isColdStartError,
  parseSentinelOrLastJson,
  shouldReapBrowser,
  superviseResidentFailure,
} from '../src/plugin.ts'
import { SENTINEL } from '../src/util.ts'

describe('parseSentinelOrLastJson', () => {
  it('优先取最后一个 sentinel 行', () => {
    const stdout = `${SENTINEL}{"ok":false}\nnoise\n${SENTINEL}{"ok":true,"url":"https://example.com"}`
    expect(parseSentinelOrLastJson(stdout)).toEqual({
      value: { ok: true, url: 'https://example.com' },
      fallback: false,
    })
  })

  it('没有 sentinel 时回落到最后一行可解析 JSON（标记 fallback）', () => {
    const stdout = 'starting\n{"ok":true,"title":"example"}\ntrailing text'
    expect(parseSentinelOrLastJson(stdout)).toEqual({
      value: { ok: true, title: 'example' },
      fallback: true,
    })
  })

  it('完全解析不出结果时返回 undefined', () => {
    expect(parseSentinelOrLastJson('')).toBeUndefined()
    expect(parseSentinelOrLastJson('boom\nnot json')).toBeUndefined()
  })
})

describe('isColdStartError', () => {
  it('识别冷启动/连接类错误', () => {
    expect(isColdStartError('connect ECONNREFUSED 127.0.0.1:9222')).toBe(true)
    expect(isColdStartError('CDP channel is not open')).toBe(true)
    expect(isColdStartError('browser is not ready')).toBe(true)
  })

  it('真实业务错误不当作冷启动', () => {
    expect(isColdStartError('element not found: "#login"')).toBe(false)
    expect(isColdStartError('')).toBe(false)
  })
})

describe('shouldReapBrowser', () => {
  it('超过空闲阈值才回收', () => {
    const now = 10_000_000
    expect(shouldReapBrowser(now, now - 6 * 60_000, 5)).toBe(true)
    expect(shouldReapBrowser(now, now - 4 * 60_000, 5)).toBe(false)
  })

  it('阈值为 0 或没有活动时间戳时不回收', () => {
    const now = 10_000_000
    expect(shouldReapBrowser(now, 0, 5)).toBe(false)
    expect(shouldReapBrowser(now, 1, 0)).toBe(false)
  })
})

describe('superviseResidentFailure', () => {
  it('连续失败累积，第 3 次起 park', () => {
    expect(superviseResidentFailure(0, 'boom')).toEqual({ failures: 1, parkReason: null })
    expect(superviseResidentFailure(1, 'boom')).toEqual({ failures: 2, parkReason: null })
    const third = superviseResidentFailure(2, 'boom')
    expect(third.failures).toBe(3)
    expect(third.parkReason).toContain('resident failed 3 times')
    expect(third.parkReason).toContain('boom')
  })
})