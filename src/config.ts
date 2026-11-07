import type { RawConfig, ResolvedConfig } from './types.ts'
export function validateEgoBinPath(value: string): { ok: boolean; reason?: string } {
  const p = typeof value === 'string' ? value.trim() : ''
  if (!p) return { ok: false, reason: 'egoBin is empty' }
  if (/\.(exe|cmd|bat)$/i.test(p)) {
    return {
      ok: false,
      reason:
        'egoBin must be a Node-executable script (.mjs/.js/.cjs), not a Windows executable. ' +
        'The official ego-browser.exe needs a Node bridge; use the bundled runtime or set egoBin to a .mjs bridge.',
    }
  }
  return { ok: true }
}

// ── user-defined extra CLI args ─────────────────────────────────────────────
/**
 * Flags the user must NOT put in `egoCliArgs`: these ego-browser subcommands
 * exit before the heredoc runs (--status/--stop/--help/...) or steal the
 * browser window (--open), so appending them would break every ego_* tool.
 * `--headless` is managed by EGO_LINUX_HEADLESS; `--sdk-path` is allowed.
 */
export const EGO_CLI_BLOCKED = new Set<string>([
  '--status',
  '--stop',
  '--open',
  '--spaces',
  '--spaces-daemon',
  '--prune-spaces',
  '--import-chrome-profile',
  '--install-desktop-entry',
  '--help',
  '-h',
])

/**
 * Flags the user must NOT put in `chromeArgs`: these are managed by the
 * launcher / EGO_LINUX_PROXY and overriding them would break CDP control,
 * profile isolation, or the proxy bypass list. `--proxy-server` should go
 * through EGO_LINUX_PROXY (which also sets the bypass list).
 */
export const CHROME_BLOCKED = new Set<string>([
  '--user-data-dir',
  '--remote-debugging-port',
  '--remote-allow-origins',
  '--headless',
  '--no-startup-window',
  '--proxy-server',
  '--proxy-bypass-list',
])

/**
 * Shell-like tokenizer for user-supplied arg strings. Handles single/double
 * quotes and backslash escapes; bare whitespace separates tokens. Returns []
 * for empty/whitespace-only input. Used for both `egoCliArgs` and `chromeArgs`
 * (mirrored in runtime/ego-linux/src/chrome.mjs for the Chrome side, since the
 * runtime must not import from src/).
 */
export function tokenizeArgs(input: unknown): string[] {
  if (typeof input !== 'string') return []
  const out: string[] = []
  let cur = ''
  let i = 0
  let quote: string | null = null
  while (i < input.length) {
    const c = input[i]!
    if (quote) {
      if (c === '\\') {
        const next = input[i + 1]
        if (next !== undefined) {
          cur += next
          i += 2
          continue
        }
      } else if (c === quote) {
        quote = null
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i += 1
      continue
    }
    if (c === '\\') {
      const next = input[i + 1]
      if (next !== undefined) {
        cur += next
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur !== '') {
        out.push(cur)
        cur = ''
      }
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  if (cur !== '') out.push(cur)
  return out
}

/**
 * Split a raw arg string into tokens, dropping any token (and, for `--flag
 * value` pairs, its value) that appears in `blocked`. A "blocked" token with a
 * `=` attached (e.g. `--headless=new`) is also dropped. Returns the surviving
 * tokens. Exposed for tests and for the runtime to mirror.
 */
export function filterArgs(raw: string, blocked: Set<string>): string[] {
  const tokens = tokenizeArgs(raw)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const key = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (blocked.has(key)) {
      // Drop a bare `--flag value` pair when the flag is blocklisted and the
      // next token does not itself look like a flag (i.e. it is the value).
      if (!tok.includes('=') && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) {
        i += 1
      }
      continue
    }
    kept.push(tok)
  }
  return kept
}

const finiteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * DSH 0.1.7 wraps a `.volatile()` field in a cosmokit `Volatile` reference: a
 * plain object exposing `get()` plus a `Symbol(cosmokit.volatile.write)` slot.
 * `typeof`/`JSON.stringify` see an opaque `{}`, so a raw read would silently
 * fall back to the default instead of the value the user saved. Reading through
 * `get()` also picks up later live commits, because the reference stays put and
 * only its value moves.
 */
export function unwrapVolatile<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const candidate = value as unknown as { get?: unknown }
  if (typeof candidate.get !== 'function') return value
  const isVolatile = Object.getOwnPropertySymbols(value).some((symbol) => String(symbol).includes('cosmokit.volatile'))
  if (!isVolatile) return value
  try {
    return (candidate.get as () => T)()
  } catch {
    return value
  }
}

/** Unwrap every volatile reference so `resolveConfig` sees plain values. */
function normalizeVolatile(config: RawConfig): RawConfig {
  const source = config as unknown as Record<string, unknown>
  const plain: Record<string, unknown> = {}
  for (const key of Object.keys(source)) plain[key] = unwrapVolatile(source[key])
  return plain as RawConfig
}

export function resolveConfig(config: RawConfig = {}): ResolvedConfig {
  config = normalizeVolatile(config)
  const legacyFps = finiteIn(config.castFpsCap, 0, 60)
    ? (config.castFpsCap === 0 ? 20 : Math.max(5, Math.min(30, config.castFpsCap)))
    : 20
  const selectedProfile = oneOf(config.streamProfile, ['low', 'balanced', 'high'], 'balanced')
  const profileDefaults = selectedProfile === 'low'
    ? { fps: 15, width: 960, bitrateKbps: 2000 }
    : selectedProfile === 'high'
      ? { fps: 30, width: 1600, bitrateKbps: 8000 }
      : { fps: 20, width: 1280, bitrateKbps: 4000 }
  return {
    chromePath: typeof config.chromePath === 'string' ? config.chromePath : '',
    captureBackend: oneOf(config.captureBackend, ['auto', 'cdp', 'ffmpeg'], 'auto'),
    streamProfile: selectedProfile,
    cdpFps: finiteIn(config.cdpFps, 5, 30) ? config.cdpFps : legacyFps,
    cdpQuality: finiteIn(config.cdpQuality, 1, 100) ? config.cdpQuality : (finiteIn(config.screencastQuality, 1, 100) ? config.screencastQuality : 55),
    // 1280 (not 960): a 960 cap downsizes a 1264-wide viewport and the panel then
    // upscales it, which is the "soft/garbled text" report. 1280 keeps the common
    // laptop viewport at native width; larger displays can raise it to 1600/1920.
    cdpMaxWidth: finiteIn(config.cdpMaxWidth, 320, 1920) ? config.cdpMaxWidth : (finiteIn(config.screencastMaxWidth, 320, 1920) ? config.screencastMaxWidth : 1280),
    cdpBackstopIntervalMs: finiteIn(config.cdpBackstopIntervalMs, 1000, 10000) ? config.cdpBackstopIntervalMs : (finiteIn(config.backstopIntervalMs, 200, 10000) ? Math.max(1000, config.backstopIntervalMs) : 3000),
    ffmpegFps: finiteIn(config.ffmpegFps, 5, 30) ? config.ffmpegFps : profileDefaults.fps,
    ffmpegMaxWidth: finiteIn(config.ffmpegMaxWidth, 320, 1920) ? config.ffmpegMaxWidth : profileDefaults.width,
    ffmpegBitrateKbps: finiteIn(config.ffmpegBitrateKbps, 500, 20000) ? config.ffmpegBitrateKbps : profileDefaults.bitrateKbps,
    ffmpegEncoder: oneOf(config.ffmpegEncoder, ['auto', 'software', 'h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'], 'auto'),
    ffmpegPath: typeof config.ffmpegPath === 'string' ? config.ffmpegPath : '',
    githubMirror: typeof config.githubMirror === 'string' ? config.githubMirror : '',
    // User-defined extra args: stored raw (string), filtered at the call site
    // so a saved value is not silently mutated by a later blocklist change.
    egoCliArgs: typeof config.egoCliArgs === 'string' ? config.egoCliArgs : '',
    chromeArgs: typeof config.chromeArgs === 'string' ? config.chromeArgs : '',
    // 0 = leave the browser's own viewport untouched (previous behavior). Both
    // dimensions must be non-zero before the emulation prelude is emitted.
    viewportWidth: finiteIn(config.viewportWidth, 0, 3840) ? config.viewportWidth : 0,
    viewportHeight: finiteIn(config.viewportHeight, 0, 2160) ? config.viewportHeight : 0,
    deviceScaleFactor: finiteIn(config.deviceScaleFactor, 0, 4) ? config.deviceScaleFactor : 0,
    isolateSpaces: typeof config.isolateSpaces === 'boolean' ? config.isolateSpaces : config.isolateSpaces === 'true' || config.isolateSpaces === '1' || config.isolateSpaces === 1,
    // Default true: two sessions silently sharing one space was the root of
    // cross-session tab theft. Explicit opt-out keeps the old shared space.
    sessionScopedSpaces: typeof config.sessionScopedSpaces === 'boolean'
      ? config.sessionScopedSpaces
      : !(config.sessionScopedSpaces === 'false' || config.sessionScopedSpaces === '0' || config.sessionScopedSpaces === 0),
    idleTimeoutMin: finiteIn(config.idleTimeoutMin, 0, 1440) ? config.idleTimeoutMin : 0,
    // Default false (= frame relay ON, unchanged behavior); the switch is opt-in.
    disableFrameRelay: typeof config.disableFrameRelay === 'boolean' ? config.disableFrameRelay : config.disableFrameRelay === 'true' || config.disableFrameRelay === '1' || config.disableFrameRelay === 1,
    // #56: opt-in resident executor (default false = today's spawn-per-call
    // behavior). 30 minutes idle is long enough to cover a session without
    // leaving a Node process around forever.
    residentExecutor: typeof config.residentExecutor === 'boolean' ? config.residentExecutor : config.residentExecutor === 'true' || config.residentExecutor === '1' || config.residentExecutor === 1,
    tuiAutoOpenPanel: typeof config.tuiAutoOpenPanel === 'boolean' ? config.tuiAutoOpenPanel : config.tuiAutoOpenPanel === 'true' || config.tuiAutoOpenPanel === '1' || config.tuiAutoOpenPanel === 1,
    residentIdleMin: finiteIn(config.residentIdleMin, 0, 1440) ? config.residentIdleMin : 30,
  }
}
