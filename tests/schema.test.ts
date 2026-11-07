import { describe, expect, it } from 'vitest'
import { toJsonSchema } from '../src/host/define-tool.ts'

describe('toJsonSchema', () => {
  it('空参数给出空对象 schema', () => {
    expect(toJsonSchema(undefined)).toEqual({ type: 'object', properties: {}, additionalProperties: false })
  })

  it('保留 description，并按 required 收集必填项', () => {
    const schema = toJsonSchema({
      url: { type: 'string', required: true, description: '目标地址' },
      wait: { type: 'boolean' },
    })
    expect(schema.properties).toEqual({
      url: { type: 'string', description: '目标地址' },
      wait: { type: 'boolean' },
    })
    expect(schema.required).toEqual(['url'])
  })

  it('text 映射成 string，json 不约束类型', () => {
    const schema = toJsonSchema({ body: { type: 'text' }, payload: { type: 'json' } })
    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(props.body?.type).toBe('string')
    expect(props.payload?.type).toBeUndefined()
  })

  it('嵌套 object 递归映射，并独立计算 required', () => {
    const schema = toJsonSchema({
      opts: {
        type: 'object',
        properties: { timeout: { type: 'number', required: true }, headless: { type: 'boolean' } },
      },
    })
    const opts = (schema.properties as Record<string, Record<string, any>>).opts
    expect(opts.type).toBe('object')
    expect(opts.required).toEqual(['timeout'])
    expect(opts.properties.headless.type).toBe('boolean')
    expect(opts.additionalProperties).toBe(true)
  })

  it('array 的 items 走同一套字段映射', () => {
    const schema = toJsonSchema({ ids: { type: 'array', items: { type: 'integer' } } })
    expect((schema.properties as Record<string, unknown>).ids).toMatchObject({
      type: 'array',
      items: { type: 'integer' },
    })
  })
})