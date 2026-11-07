/**
 * 验证会话隔离：sessionScopedSpaces 下每个 Pi 会话拿到自己的 ego 空间名。
 * 运行：node scripts/smoke-sessions.mjs
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, { interopDefault: true })
const { createSessionScopedSpaceTracker, spaceNameForSession } = await jiti.import('../src/plugin.ts')

const problems = []
const name = (sessionId) => spaceNameForSession(sessionId, 'pi-agent', true)

if (name('session-alpha') === name('session-beta')) problems.push('scoped sessions share one space name')
if (name('session-alpha') !== 'pi-agent-alpha') problems.push(`unexpected scoped name: ${name('session-alpha')}`)
if (spaceNameForSession('session-alpha', 'pi-agent', false) !== 'pi-agent') problems.push('opt-out must keep the base space')
if (spaceNameForSession(undefined, 'pi-agent', true) !== 'pi-agent') problems.push('missing session must fall back to the base space')

const tracker = createSessionScopedSpaceTracker('pi-agent', () => true)
if (tracker.forSession('session-alpha') === tracker.forSession('session-beta')) problems.push('trackers are shared across sessions')

console.log('problems=' + problems.length)
for (const problem of problems) console.log(' -', problem)
process.exit(problems.length === 0 ? 0 : 1)