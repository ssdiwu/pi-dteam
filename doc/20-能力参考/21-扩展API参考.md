# Pi 扩展 API 参考

> 来源：研究 `@majorgilles/pi-grill-me` 时整理的 Pi 扩展 API 表面清单。
> 用途：dteam v2 任何"拦截 / UI 增强 / 持久化"改动的参考索引。
> 与 `../90-归档/版本实施方案/41-工具动态加载方案.md` 配套：那份是设计稿，这份是参考表。
>
> **0.8 状态注记（2026-07-14）**：当前 `index.ts` 使用 `pi.registerTool` 注册唯一模型工具 `dteam`（`dispatch` / `respond`），并注册 `/dteam` 管理命令。Worker Snapshot 的实时文本、thinking、当前工具和 timeout 诊断由 `/dteam` Modal 展示；不做跨 session 持久化或 resume。本文仍只记录 Pi 扩展 API 表面，不替代 `doc/10-架构与运行/12-API参考.md` 的 dteam 契约。

## 全量 API 表面

| 类别 | API | 作用 | grill-me 怎么用 |
|------|-----|------|----------------|
| 命令 | `pi.registerCommand(name, {handler})` | slash 命令 | `/grill`, `/checkpoint` |
| 工具 | `pi.registerTool({name, parameters, execute, renderCall, renderResult})` | LLM 可调工具 | 6 个 `grill_*` |
| **拦截** | `pi.on("tool_call", async (e) => { block, reason })` | **拦 / 改 tool 调用** | read-only 门控 |
| 注入 | `pi.on("before_agent_start", async (e) => { systemPrompt })` | 改 systemPrompt | Socratic 规则 |
| 生命周期 | `pi.on("session_start", handler)` | session 启动 | 装 editor、恢复 state |
| 状态栏 | `ctx.ui.setStatus("name", text)` | footer | `🔥 grill: select output` |
| Widget | `ctx.ui.setWidget("name", lines, {placement})` | editor 下方 | phase + 备选 |
| 输入框 | `ctx.ui.setEditorComponent(factory)` | 替换输入框 | Tab 循环 |
| 补全 | `ctx.ui.addAutocompleteProvider((cur) => new)` | 包 autocomplete | 备选答案 |
| Overlay | `ctx.ui.custom<T>(factory, opts)` | 弹层 | checkpoint 浏览器 |
| 持久化 | `pi.appendEntry(type, data)` | 写 session entry | 状态存档 |
| 注入消息 | `pi.sendUserMessage(text)` | 程序化"用户"消息 | 启动 session |
| 注入系统消息 | `pi.sendMessage({customType, content, display})` | 注入 system | 显示状态 |

## 对 dteam 现状的影响

| 能力 | dteam 是否在用 | 备注 |
|------|:---:|------|
| `registerTool` | ✅ | `index.ts` 注册唯一模型工具 `dteam`，由 `type=dispatch/respond` 区分派发与恢复回应 |
| `registerCommand` / `ctx.ui.custom` | ✅ | 注册 `/dteam` 管理命令和有包边的 worker 列表/详情 Modal |
| `ctx.ui.setStatus` / `notify` | ✅ | 显示后台 worker 的单次状态反馈 |
| tool_call 拦截 | ❌ | 工具白名单已在 fresh worker 边界收敛；不为旧 explore 角色加拦截 |
| setEditorComponent / Widget | ❌ | 不使用这两类 UI 扩展点；运行态由 `/dteam` Modal 展示 |
| appendEntry | ❌ | 不做跨 session 持久化或 resume |
| 其余 API | ❌ | 当前不需要 |

## grill-me 包的处置

- 不直接吸收（与 dteam 正交：grill-me 是"想清楚"，dteam 是"动手做"）
- 不直接装用（v1 设计原则："v1 故意只暴露 1 个工具"）
- 它教会的就是**这张表**，下次 v2 改动时直接查这里

## 来源

- grill-me 源码：`/tmp/grill-me-inspect/package/`（DESIGN.md 301 行、index.ts 1074 行）
- Pi 扩展 API 原生定义：`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- 关键导出 `discoverAndLoadExtensions(configuredPaths, cwd, agentDir?)` → `{ extensions, errors, runtime }`，每个 `Extension.tools: Map<string, RegisteredTool>`
