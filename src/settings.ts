// Host-side seam between the `ego-browser` config surface and the rest of the
// plugin (tool registration + the local cast/gateway routes).
//
// Pi has no settings service: the implementation lives in
// `host/settings-lite.ts`, which reads/writes `pi-ego.json` and keeps this
// interface so the gateway code stays unchanged.
import type { SettingsScope } from './types.ts'

/** Settings namespace under which ego-browser config persists. */
export const SETTINGS_NAMESPACE = 'ego-browser'

export interface SettingsBridge {
  /** Current merged config: composition defaults + persisted overrides. */
  source(): Record<string, unknown>
  /** Subscribe to committed changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void
  /** Scope handle, exposed for callers that need to write settings back. */
  readonly scope?: SettingsScope | null
}