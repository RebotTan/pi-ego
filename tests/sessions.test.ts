import { describe, expect, it } from 'vitest'
import { createSessionScopedSpaceTracker, scopedTargetKey, spaceNameForSession } from '../src/plugin.ts'

describe('spaceNameForSession', () => {
  it('会话前缀被剥掉，截前 8 位拼到 space 名后', () => {
    expect(spaceNameForSession('session-abcdefgh1234', 'dsh-agent', true)).toBe('dsh-agent-abcdefgh')
  })

  it('未开会话隔离时原样返回默认 space', () => {
    expect(spaceNameForSession('session-abc', 'dsh-agent', false)).toBe('dsh-agent')
  })

  it('没有 session id（子代理/CLI 直调）时回落到默认 space', () => {
    expect(spaceNameForSession(undefined, 'dsh-agent', true)).toBe('dsh-agent')
    expect(spaceNameForSession('', 'dsh-agent', true)).toBe('dsh-agent')
  })

  it('剔除不安全字符，全部被剔除时回落到默认 space', () => {
    expect(spaceNameForSession('session-a/b c:d', 'base', true)).toBe('base-abcd')
    expect(spaceNameForSession('session-///', 'base', true)).toBe('base')
  })

  it('数字型默认 space 也保留', () => {
    expect(spaceNameForSession('session-xyz', 7, true)).toBe('7-xyz')
  })
})

describe('scopedTargetKey', () => {
  it('同一 space 的两个会话得到不同 key', () => {
    expect(scopedTargetKey('s1', 'iso')).not.toBe(scopedTargetKey('s2', 'iso'))
    expect(scopedTargetKey('s1', 'iso')).toBe(scopedTargetKey('s1', 'iso'))
  })
})

describe('createSessionScopedSpaceTracker', () => {
  it('每个会话拿到自己的 tracker，互不影响', () => {
    const tracker = createSessionScopedSpaceTracker('base', () => true)
    expect(tracker.forSession('session-alpha')).toBe(tracker.forSession('session-alpha'))
    expect(tracker.forSession('session-alpha')).not.toBe(tracker.forSession('session-beta'))
    expect(tracker.forSession('session-alpha').current()).toBe('base-alpha')
    expect(tracker.forSession('session-beta').current()).toBe('base-beta')
  })

  it('关闭会话隔离时共享基础 space', () => {
    const tracker = createSessionScopedSpaceTracker('base', () => false)
    expect(tracker.forSession('session-alpha').current()).toBe('base')
    expect(tracker.forSession('session-beta').current()).toBe('base')
  })
})