/**
 * DSH `defineTool` 的兼容垫片：保留原工具定义的全部字段，由 Pi 入口转换为
 * Pi ToolDefinition。参数仍是 DSH 的简洁对象形状，见 toJsonSchema。
 */
import type { ToolExec } from '../types.ts'

export interface HostTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output?: { schema?: unknown; render?: (args: unknown, value: unknown) => unknown }
  timeoutMs?: number
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<unknown> | unknown
  presentCall?: (...args: unknown[]) => unknown
}

export function defineTool<T extends HostTool>(opts: T): T {
  return opts
}

/** DSH 参数对象 → JSON Schema（Pi/TypeBox 接受的标准 schema）。 */
export function toJsonSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(parameters ?? {})) {
    const field = (raw ?? {}) as Record<string, unknown>
    if (field.required === true) required.push(key)
    properties[key] = fieldSchema(field)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function fieldSchema(field: Record<string, unknown>): Record<string, unknown> {
  const { required: _required, type, description, default: dflt, ...rest } = field
  const out: Record<string, unknown> = { ...rest }
  if (typeof description === 'string') out.description = description
  if (dflt !== undefined) out.default = dflt
  switch (type) {
    case 'text':
      out.type = 'string'
      break
    case 'json':
      // 任意 JSON 值：省略 type 即不约束
      return Object.keys(out).length > 0 ? out : {}
    case 'object': {
      const properties = field.properties as Record<string, Record<string, unknown>> | undefined
      if (properties !== undefined) {
        out.properties = toJsonSchema(properties).properties
        const req = Object.entries(properties)
          .filter(([, v]) => (v as Record<string, unknown>)?.required === true)
          .map(([k]) => k)
        if (req.length > 0) out.required = req
      }
      if (out.additionalProperties === undefined) out.additionalProperties = true
      return out
    }
    case 'array': {
      const items = field.items as Record<string, unknown> | undefined
      out.type = 'array'
      if (items !== undefined) out.items = fieldSchema(items)
      return out
    }
    case undefined:
      return out
    default:
      out.type = type
      break
  }
  return out
}