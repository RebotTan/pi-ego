/**
 * 多实例租约：ego 的后备 Chromium 是单例，`--stop` 会关掉所有 Pi 会话正在用的
 * 窗口。这里用 stateDir/users/<pid>.json 记录存活使用者，只有最后一个退出时才
 * 允许 --stop；崩溃残留的 pid 在下次读取时按 liveness 清掉。
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function egoStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EGO_LINUX_STATE_DIR) return env.EGO_LINUX_STATE_DIR
  const home = env.HOME || env.USERPROFILE || (process.platform === 'win32' ? env.LOCALAPPDATA || '' : homedir())
  return process.platform === 'win32'
    ? `${env.LOCALAPPDATA || `${home}\\AppData\\Local`}\\ego-lite-linux`
    : `${env.XDG_STATE_HOME || `${home}/.local/state`}/ego-lite-linux`
}

export interface InstanceLease {
  /** 释放自己的登记；返回释放后是否已无其他存活实例。 */
  release(): boolean
  /** 当前是否没有其他存活实例（用于空闲回收）。 */
  isLastUser(): boolean
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 其他存活实例的 pid（顺带删除崩溃残留的登记）。 */
function otherUsers(dir: string, selfPid: number): number[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const pids: number[] = []
  for (const entry of entries) {
    const match = /^(\d+)\.json$/.exec(entry)
    if (!match) continue
    const pid = Number(match[1])
    if (pid === selfPid) continue
    if (alive(pid)) pids.push(pid)
    else {
      try {
        unlinkSync(join(dir, entry))
      } catch {
        /* another instance may have cleaned it first */
      }
    }
  }
  return pids
}

export function acquireInstanceLease(stateDir = egoStateDir()): InstanceLease {
  const dir = join(stateDir, 'users')
  const selfPid = process.pid
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${selfPid}.json`), JSON.stringify({ pid: selfPid, at: Date.now() }))
  } catch {
    /* no writable state dir: behave as a single instance */
  }
  return {
    release() {
      try {
        unlinkSync(join(dir, `${selfPid}.json`))
      } catch {
        /* already gone */
      }
      return otherUsers(dir, selfPid).length === 0
    },
    isLastUser() {
      return otherUsers(dir, selfPid).length === 0
    },
  }
}

export function readBrowserPid(stateDir = egoStateDir()): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir, 'browser.json'), 'utf8')) as { pid?: unknown }
    return Number.isInteger(parsed.pid) && (parsed.pid as number) > 0 ? (parsed.pid as number) : undefined
  } catch {
    return undefined
  }
}