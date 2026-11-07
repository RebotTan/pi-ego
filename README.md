# pi-ego-browser

ego-lite 浏览器自动化在 Pi coding agent 里的扩展：35 个 `ego_*` 工具 + 一个可选的本地实时观察页。

浏览器运行时来自 [ego-lite](https://github.com/deepseek-ai/ego-lite)（见 `runtime/`），每个 Pi 会话拿到自己的 task space，多个 Pi 进程共用同一个 Chromium 但只有最后一个退出的实例会关掉它。

## 安装

```bash
npm install            # 会跑 prepare → 构建 bin/ego-cast-worker.mjs
pi install ./           # 或把本目录链接进 ~/.pi/agent/extensions
```

要求 Node >= 22；首次调用工具时会自动准备 Chromium（也可以用 `ego_doctor` 检查环境）。

## 工具

`ego_navigate / ego_snapshot / ego_click / ego_fill / ego_js / ego_screenshot / ego_tabs / ego_wait* / ego_cdp / ego_cli / ego_script / ego_doctor …`，共 35 个，`ego_help` 里有完整清单。截图直接以内联图片返回给模型。

## 观察页（阶段 3）

扩展挂载时会在 `127.0.0.1` 起一个随机端口的 HTTP 服务，只接受随机 token：

- 会话内提示一次地址（`ui.notify`），也写在 `<stateDir>/observe.json`（Windows 下 `%LOCALAPPDATA%\ego-lite-linux\observe.json`）。
- 打开 `http://127.0.0.1:<port>/?token=…` 即可看到当前页面的实时画面（CDP screencast JPEG），可点击、滚轮、键盘输入、直接改 URL。
- token 进页面后会写进 `HttpOnly` cookie，页面内的 `/api/ego/*` 请求无需再带 query；不带 token 的请求一律 401。
- 固定端口用 `PI_EGO_PORT=8787` 指定；被占用时自动退回随机端口。
- 画面关闭后 worker 会停止采集，不影响工具本身。

## 配置

`~/.pi/agent/pi-ego.json`（或 `PI_EGO_CONFIG` 指定的文件），每次读盘、改了即生效。常用键：`chromePath`、`defaultSpace`、`sessionScopedSpaces`、`idleTimeoutMin`、`disableFrameRelay`。这些键在每次调用时读取，无需重启会话。

## 开发

```bash
npm run typecheck
npm run unit    # vitest：schema 映射、会话 space、实例租约、结果解析、观察服务鉴权
npm run smoke:ci # 不需要浏览器的冒烟（CI 跑这一组）
npm test        # 构建 worker + 单测 + 9 个冒烟脚本（含真实浏览器闭环与观察页 SSE）
```

目录结构：`src/index.ts` 是 Pi 入口，`src/plugin.ts` 是原 DSH 插件主体（工具定义与执行路径），`src/host/` 是 Pi 侧的宿主垫片（subprocess / settings / webserver / 实例租约）。

## 许可

MIT。运行时与第三方组件见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。