import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { resolveEgoEnv } from '../src/plugin.ts'

// #93: macOS 27 + Chrome 156 silently stop flushing the cookie jar to disk when
// the login Keychain is in use; the vendored runtime then adds --use-mock-keychain.
// The host only bridges the setting, so these are the whole contract.
describe('useMockKeychain setting', () => {
  it('defaults to off', () => {
    expect(resolveConfig({}).useMockKeychain).toBe(false)
  })

  it('accepts booleans and string/number truthy values', () => {
    for (const v of [true, 'true', 1, '1'] as const) {
      expect(resolveConfig({ useMockKeychain: v }).useMockKeychain).toBe(true)
    }
    for (const v of [false, 'false', 0, '0'] as const) {
      expect(resolveConfig({ useMockKeychain: v }).useMockKeychain).toBe(false)
    }
  })
})

describe('resolveEgoEnv useMockKeychain bridge', () => {
  const env = (platform: NodeJS.Platform, cfg: Record<string, unknown>) =>
    resolveEgoEnv(cfg, { platform, baseEnv: {} })

  it('injects EGO_LINUX_USE_MOCK_KEYCHAIN=1 on darwin only', () => {
    expect(env('darwin', { useMockKeychain: true }).EGO_LINUX_USE_MOCK_KEYCHAIN).toBe('1')
    expect(env('win32', { useMockKeychain: true }).EGO_LINUX_USE_MOCK_KEYCHAIN).toBeUndefined()
    expect(env('linux', { useMockKeychain: true }).EGO_LINUX_USE_MOCK_KEYCHAIN).toBeUndefined()
  })

  it('does not inject when the setting is off', () => {
    expect(env('darwin', { useMockKeychain: false }).EGO_LINUX_USE_MOCK_KEYCHAIN).toBeUndefined()
  })

  it('keeps a user-set environment variable', () => {
    const out = resolveEgoEnv(
      { useMockKeychain: true },
      { platform: 'darwin', baseEnv: { EGO_LINUX_USE_MOCK_KEYCHAIN: '0' } },
    )
    expect(out.EGO_LINUX_USE_MOCK_KEYCHAIN).toBe('0')
  })
})