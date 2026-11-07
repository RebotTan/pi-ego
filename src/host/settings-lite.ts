/**
 * Pi 侧配置：一个 JSON 文件 + 进程内覆盖，替代 DSH 的 settings 命名空间。
 * 读取时机与 DSH 相同（每次 spawn 都经 bridge.source() 现读）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export interface SettingsBridge {
  source(): Record<string, unknown>
  onChange(cb: () => void): () => void
}

export function settingsFilePath(): string {
  if (process.env.PI_EGO_CONFIG) return process.env.PI_EGO_CONFIG
  const agentDir = process.env.PI_CONFIG_DIR ?? join(homedir(), '.pi', 'agent')
  return join(agentDir, 'pi-ego.json')
}

function readDisk(): Record<string, unknown> {
  try {
    const path = settingsFilePath()
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function writeSettings(patch: Record<string, unknown>): void {
  const path = settingsFilePath()
  const next = { ...readDisk(), ...patch }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
}

export function createSettingsBridge(entry: Record<string, unknown>): SettingsBridge {
  const listeners = new Set<() => void>()
  return {
    source: () => ({ ...entry, ...readDisk() }),
    onChange: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}