/**
 * 观察页：单文件、零依赖，只用相对路径 /api/ego/*（token 已在 HttpOnly cookie 里）。
 * 画面来自 worker 的 JPEG 帧，点击/滚轮/键盘按 CDP Input 语义回放。
 */
export const OBSERVE_PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ego-browser 观察页</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #101215; color: #d7dce2; }
  header { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #242a31; }
  header input { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #2c343d; border-radius: 6px; background: #171b20; color: inherit; }
  button { padding: 6px 10px; border: 1px solid #2c343d; border-radius: 6px; background: #1d232a; color: inherit; cursor: pointer; }
  button:hover { background: #263039; }
  #state { padding: 0 8px; color: #7b8794; white-space: nowrap; }
  #stage { padding: 8px; overflow: auto; }
  #shot { display: block; width: 100%; height: auto; background: #000; border-radius: 6px; cursor: crosshair; }
  #shot[hidden] { display: none; }
  #hint { padding: 40px 8px; text-align: center; color: #6b7783; }
</style>
</head>
<body>
<header>
  <input id="url" placeholder="https://example.com" spellcheck="false">
  <button id="go">打开</button>
  <button id="reload">刷新</button>
  <span id="state">连接中…</span>
</header>
<div id="stage">
  <div id="hint">等待画面…（浏览器里需要有一个 ego 会话页面）</div>
  <img id="shot" hidden alt="screencast">
</div>
<script>
const shot = document.getElementById('shot');
const hint = document.getElementById('hint');
const state = document.getElementById('state');
let targetId = null, vw = 0, vh = 0;

function setState(text) { state.textContent = text; }

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false }));
}

function input(payload) {
  if (!targetId) return;
  return post('/api/ego/input', { targetId, ...payload });
}

// worker 只在有 watcher 时采集，所以先挑一个目标页开 watch，再订阅画面。
const clientId = 'pi-ego-' + Math.random().toString(36).slice(2, 10);
let watching = null;
let stream = null;

async function pickTarget() {
  const res = await fetch('/api/ego/spaces').then((r) => r.json()).catch(() => null);
  const spaces = (res && res.spaces) || [];
  const active = spaces.find((s) => s.active) || spaces[0];
  return active ? (active.targetId || (active.targetIds || [])[0]) : null;
}

async function watch(target) {
  if (!target || watching === target) return;
  const body = { clientId, targetId: target };
  const result = watching ? await post('/api/ego/watch/switch', body) : await post('/api/ego/watch/start', body);
  if (result && result.ok) { watching = target; targetId = target; setState('正在采集'); }
  else setState('采集失败：' + ((result && result.error) || 'unknown'));
}

async function start() {
  await watch(await pickTarget());
  if (stream) return;
  stream = new EventSource('/api/ego/stream');
  stream.addEventListener('frame', (event) => {
    const frame = JSON.parse(event.data);
    targetId = frame.targetId;
    vw = frame.vw || 0; vh = frame.vh || 0;
    shot.src = 'data:image/jpeg;base64,' + frame.data;
    shot.hidden = false; hint.hidden = true;
    setState('已连接 ' + (vw ? vw + '×' + vh : ''));
  });
  stream.addEventListener('spaces', (event) => {
    try {
      const data = JSON.parse(event.data);
      const spaces = data.spaces || [];
      const active = spaces.find((s) => s.active) || spaces[0];
      const next = active && active.targetId;
      if (next && next !== watching) void watch(next);
    } catch { /* ignore */ }
  });
  stream.addEventListener('capture-status', (event) => {
    const status = JSON.parse(event.data);
    if (status.state && status.state !== 'running') setState('采集：' + status.state);
  });
  stream.onerror = () => setState('连接断开，重试中…');
}

window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/api/ego/watch/stop', new Blob([JSON.stringify({ clientId })], { type: 'application/json' }));
});
void start();

function point(event) {
  const rect = shot.getBoundingClientRect();
  const w = vw || shot.naturalWidth;
  const h = vh || shot.naturalHeight;
  return {
    x: Math.round((event.clientX - rect.left) * (w / rect.width)),
    y: Math.round((event.clientY - rect.top) * (h / rect.height)),
  };
}

shot.addEventListener('mousedown', (event) => {
  const p = point(event);
  input({ type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
});
shot.addEventListener('mouseup', (event) => {
  const p = point(event);
  input({ type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 });
  shot.focus();
});
shot.addEventListener('wheel', (event) => {
  event.preventDefault();
  const p = point(event);
  input({ type: 'mouseWheel', ...p, deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) });
}, { passive: false });

// 页面键盘：可打印字符走 insertText，其余走 keyDown/keyUp。
shot.tabIndex = 0;
shot.addEventListener('keydown', (event) => {
  if (event.key.length === 1 || event.key === 'Enter') {
    input({ type: 'keyDown', key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode });
    input({ type: 'keyUp', key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode });
  }
  if (event.key === 'Backspace' || event.key.startsWith('Arrow') || event.key === 'Tab') {
    input({ type: 'keyDown', key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode });
    input({ type: 'keyUp', key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode });
  }
});

document.getElementById('go').onclick = () => {
  const url = document.getElementById('url').value.trim();
  if (url) post('/api/ego/navigate', { url });
};
document.getElementById('reload').onclick = () => post('/api/ego/navigate', { reload: true });
document.getElementById('url').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('go').click();
});
</script>
</body>
</html>`