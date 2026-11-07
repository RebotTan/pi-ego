/**
 * 验证多实例租约：另一个存活 Pi 进程存在时，本进程不认为自己能停共享浏览器。
 * 运行：node scripts/smoke-lease.mjs
 */
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const { acquireInstanceLease } = await jiti.import('../src/host/instance.ts')

const dir = mkdtempSync(join(tmpdir(), 'pi-ego-lease-'))
const problems = []

// 1. 只有自己：独占 → 有权 --stop。
const solo = acquireInstanceLease(dir)
if (!solo.isLastUser()) problems.push('solo: expected last user')
if (solo.release() !== true) problems.push('solo: release should report last user')

// 2. 另一个存活 pid（父进程）：不能停别人的浏览器。
writeFileSync(join(dir, 'users', `${process.ppid}.json`), JSON.stringify({ pid: process.ppid }))
const shared = acquireInstanceLease(dir)
if (shared.isLastUser()) problems.push('shared: must not be last user')
if (shared.release() !== false) problems.push('shared: release must report other users')

// 3. 崩溃残留（不存在的 pid）被当作已退出。
unlinkSync(join(dir, 'users', `${process.ppid}.json`))
writeFileSync(join(dir, 'users', '999999.json'), JSON.stringify({ pid: 999999 }))
const afterCrash = acquireInstanceLease(dir)
if (!afterCrash.isLastUser()) problems.push('crash: stale pid should not count')
afterCrash.release()

rmSync(dir, { recursive: true, force: true })
console.log(`problems=${problems.length}`)
for (const problem of problems) console.log(' -', problem)
process.exit(problems.length === 0 ? 0 : 1)