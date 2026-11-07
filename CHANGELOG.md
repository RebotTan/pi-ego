# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-07

首个可用的 Pi 扩展版本：把 DSH 插件 `ego-browser` 迁到 Pi，工具行为保持与浏览器运行时一致。

### Added

- 35 个 `ego_*` 工具注册到 Pi（导航、快照、点击、填写、JS 求值、截图、CDP、等待、上传下载、验证码、`ego_script` 等），参数沿用 DSH 形状并转换为标准 JSON Schema。
- `src/host/` 宿主垫片：`subprocess`（stdin 脚本 + stdout/stderr 溢写）、`settings`（`~/.pi/agent/pi-ego.json` 热读）、`define-tool`、`webserver`、`tui-bridge`、`instance`（多实例租约）。
- 截图以内联图片返回给模型（PNG/JPEG，≤8MB）；非图片结果按 50KB 截断。
- 会话隔离：每个 Pi 会话默认占用独立 task space（`dsh-agent-<sid8>`），`sessionScopedSpaces` 可关闭。
- 多实例协作：`<stateDir>/users/<pid>.json` 登记存活实例，只有最后一个退出的 Pi 才执行 `--stop`，崩溃残留按 pid 存活探测清理。
- 本地实时观察页：`127.0.0.1` 随机端口 + 随机 token，SSE 实时画面、点击/滚轮/键盘回放、URL 导航；地址写入 `<stateDir>/observe.json` 并在会话内提示。
- 冒烟脚本 9 个（`scripts/smoke-*.mjs`）与 vitest 单元测试 30 例（schema 映射、会话 space、实例租约、结果解析、观察服务鉴权）。

### Changed

- 退出清理从 fire-and-forget 改为 `spawnSync`（3s 超时）：宿主进程退出时异步 `--stop` 会被掐断，导致 Chromium 泄漏。
- `ctx.effect` 语义修正为「立即执行、返回值即清理函数」，此前安装时就会执行清理逻辑。
- `runtime/ego-linux/src/paths.mjs` 的 `DATA_DIR` / `STATE_DIR` 支持 `EGO_LINUX_DATA_DIR` / `EGO_LINUX_STATE_DIR` 覆盖，便于隔离测试。
- worker 改用 esbuild 打包（`--external:ws`），产物 `bin/ego-cast-worker.mjs` 由 `prepare` 生成。
- 发布包用 `files` 白名单，避免 `bin/` 被 `.gitignore` 排除而缺失。

### Fixed

- `toJsonSchema` 的嵌套 `object` 参数缺少 `type: 'object'`，导致 Pi/TypeBox 把子对象当作任意值。
- 观察页在 worker 无 watcher 时不出画面：页面打开即自动 `watch/start`，切换 tab 时 `watch/switch`。

### Removed

- DSH 专属的右栏面板、TUI 组件与 `@deepseek-ai/*` 依赖；Pi 侧以观察页 + `ui.notify` 替代。
