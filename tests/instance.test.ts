import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireInstanceLease, egoStateDir, readBrowserPid } from '../src/host/instance.ts'

const dirs: string[] = []
function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ego-lease-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('egoStateDir', () => {
  it('EGO_LINUX_STATE_DIR 优先', () => {
    expect(egoStateDir({ EGO_LINUX_STATE_DIR: '/tmp/custom' } as NodeJS.ProcessEnv)).toBe('/tmp/custom')
  })
})

describe('acquireInstanceLease', () => {
  it('独占时是最后一个使用者，释放返回 true', () => {
    const dir = tempStateDir()
    const lease = acquireInstanceLease(dir)
    expect(lease.isLastUser()).toBe(true)
    expect(lease.release()).toBe(true)
    expect(readdirSync(join(dir, 'users'))).toHaveLength(0)
  })

  it('有另一个存活实例时不算最后一个，释放返回 false', () => {
    const dir = tempStateDir()
    const lease = acquireInstanceLease(dir)
    // 用父进程 pid 当"另一个实例"的登记：它一定活着且与当前进程不同。
    writeFileSync(join(dir, 'users', `${process.ppid}.json`), JSON.stringify({ pid: process.ppid }))
    expect(lease.isLastUser()).toBe(false)
    expect(lease.release()).toBe(false)
  })

  it('崩溃残留的 pid 被当成已退出并清理', () => {
    const dir = tempStateDir()
    const lease = acquireInstanceLease(dir)
    writeFileSync(join(dir, 'users', '999999.json'), JSON.stringify({ pid: 999999 }))
    expect(lease.isLastUser()).toBe(true)
    expect(readdirSync(join(dir, 'users'))).toEqual([`${process.pid}.json`])
    lease.release()
  })
})

describe('readBrowserPid', () => {
  it('读取 browser.json 里的 pid，缺失或非法时返回 undefined', () => {
    const dir = tempStateDir()
    expect(readBrowserPid(dir)).toBeUndefined()
    writeFileSync(join(dir, 'browser.json'), JSON.stringify({ pid: 4321 }))
    expect(readBrowserPid(dir)).toBe(4321)
    writeFileSync(join(dir, 'browser.json'), JSON.stringify({ pid: -1 }))
    expect(readBrowserPid(dir)).toBeUndefined()
  })
})