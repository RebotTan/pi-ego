/**
 * Pi 没有 DSH 的 tuiStatus/tuiToast 服务，这里只保留插件内部用到的三种能力：
 * toast、hasToast、setStatusOverride。toast 走 Pi 的 notify（TUI/RPC 可用）。
 */
import type { TuiStatusTone } from '../tui/types.ts'

export interface TuiStatusOverride {
  text: string
  tone: TuiStatusTone
  detail: string
  onClick?: () => void
}

export interface TuiBridge {
  toast(text: string, color: 'success' | 'warning' | 'error'): void
  hasToast(): boolean
  setStatusOverride(value?: TuiStatusOverride): void
}

export type Notify = (message: string, level: 'info' | 'warning' | 'error') => void

export function createTuiBridge(notify: Notify): TuiBridge {
  return {
    toast(text, color) {
      notify(text, color === 'error' ? 'error' : color === 'warning' ? 'warning' : 'info')
    },
    hasToast() {
      return true
    },
    setStatusOverride(_value?: TuiStatusOverride) {
      /* no status field on the Pi side yet */
    },
  }
}