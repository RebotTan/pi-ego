import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Collector } from '../src/host/subprocess.ts'

describe('Collector 溢写上限', () => {
  it('超过 spill.maxBytes 后停止写盘：溢写文件不超过上限且 lossy=true', () => {
    const c = new Collector(2048, 8192)
    for (let i = 0; i < 200; i++) c.push(Buffer.alloc(1024, 0x78)) // 200KB total
    const read = c.readFrom(0)
    expect(read.lossy).toBe(true)
    expect(read.spillPath).toBeDefined()
    expect(existsSync(read.spillPath!)).toBe(true)
    // 修复前：超限后仍继续 appendFileSync，文件可无限增长。
    expect(statSync(read.spillPath!).size).toBeLessThanOrEqual(8192)
    c.dispose()
  })

})