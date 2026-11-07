/**
 * `ctx.subprocess` 的 Node 实现：stdin 写入脚本、stdout/stderr 分别限额、
 * graceMs 后 SIGTERM→SIGKILL、AbortSignal 取消。接口与原 DSH 服务一致，
 * 因此 runEgoScript 等执行路径无需改写。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CollectReader, SpawnSpec, SubprocessHandle, SubprocessService } from '../types.ts'

class Collector implements CollectReader {
  private chunks: Buffer[] = []
  private size = 0
  private truncated = false
  private spillPath: string | undefined
  private spillDir: string | undefined

  constructor(private readonly maxBytes: number, private readonly spillMaxBytes: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.maxBytes) {
      this.spill(chunk)
      return
    }
    const room = this.maxBytes - this.size
    if (chunk.length <= room) {
      this.chunks.push(chunk)
      this.size += chunk.length
      return
    }
    this.chunks.push(chunk.subarray(0, room))
    this.size = this.maxBytes
    this.truncated = true
    this.spill(chunk.subarray(room))
  }

  private spill(chunk: Buffer): void {
    if (this.spillMaxBytes <= 0) return
    if (this.spillDir === undefined) {
      this.spillDir = mkdtempSync(join(tmpdir(), 'pi-ego-'))
      this.spillPath = join(this.spillDir, 'output.log')
    }
    try {
      appendFileSync(this.spillPath!, chunk)
    } catch {
      /* spill is best-effort */
    }
    this.outSpilled = (this.outSpilled ?? 0) + chunk.length
    if ((this.outSpilled ?? 0) > this.spillMaxBytes) this.truncated = true
  }

  private outSpilled: number | undefined

  readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } {
    const all = Buffer.concat(this.chunks)
    return {
      text: all.subarray(offset).toString('utf8'),
      nextOffset: all.length,
      lossy: this.truncated,
      ...(this.spillPath !== undefined ? { spillPath: this.spillPath } : {}),
    }
  }

  dispose(): void {
    if (this.spillDir !== undefined) {
      try {
        rmSync(this.spillDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

export const nodeSubprocess: SubprocessService = {
  spawn(spec: SpawnSpec): SubprocessHandle {
    const [command, ...args] = spec.argv
    const stdout = new Collector(spec.stdio.stdout.maxBytes, spec.stdio.stdout.spill?.maxBytes ?? 0)
    const stderr = new Collector(spec.stdio.stderr.maxBytes, spec.stdio.stderr.spill?.maxBytes ?? 0)
    const child = spawn(command, args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    let settled = false
    let graceTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined
    const terminate = (): void => {
      if (settled || child.exitCode !== null) return
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 5000)
      killTimer.unref()
    }

    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        settled = true
        if (graceTimer !== undefined) clearTimeout(graceTimer)
        if (killTimer !== undefined) clearTimeout(killTimer)
        resolve({ exitCode: code, signal })
      }
      child.on('error', () => finish(null, null))
      child.on('close', (code, signal) => finish(code, signal))
      graceTimer = setTimeout(terminate, Math.max(0, spec.graceMs))
      graceTimer.unref()
      spec.signal?.addEventListener('abort', terminate, { once: true })
      if (spec.signal?.aborted === true) terminate()
    })

    // A tool that stopped reading must not keep the child alive forever.
    done.then(() => {
      stdout.dispose()
      stderr.dispose()
      child.stdin?.destroy()
    })

    try {
      child.stdin?.on('error', () => {
        /* EPIPE after the child exits is expected */
      })
      child.stdin?.end(spec.stdio.stdin.data)
    } catch {
      /* the child may have exited before accepting stdin */
    }

    return { done, collected: { stdout, stderr } }
  },
}