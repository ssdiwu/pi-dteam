# P4 — 用户接口层

> 依赖 P0-P3，提供 Pi 扩展入口和 TUI 渲染。

## 模块清单

| 文件 | 职责 |
|------|------|
| `index.ts` | 扩展入口：注册 21+ 工具、`/dteam` 命令 |
| `dteamTool.ts` | dteam 调度入口工具：list/plan/run/status 4 个 action |
| `renderers.ts` | TUI 渲染：worker 进度消息渲染、底部状态栏 + `WorkerProgressStore`（模块级 Map<workerId, WorkerProgress>） |
| `worker-widget.ts` | Worker 状态 Widget：折叠态（多 worker 单行 + 缩进 + 信号角标）+ Tab 面板（`/dteam` 触发，多 worker 切换 + 嵌套详情 + `ctx.ui.custom` 覆盖层）+ 信号桥接（bus → store）+ 纯函数（`buildTabBar` / `buildTabContent` / `formatNestedWorkers`） |

## 注册的工具

| 类别 | 工具 |
|------|------|
| Task | task_create/read/update/complete/archive/list/search |
| Worker | worker_create/start/sendSignal/cancel/status/saveMemory/loadMemory/getMemory |
| Dteam | dteam（list/plan/run/status） |
| Memory | memory_get/set/keys/has/delete/clear/save/load |
| Signal | signal_emit/history |
| Reference | reference_architecture |

## 注册的命令

- `/dteam` — 切换 worker Tab 面板（折叠态 ↔ 多 worker Tab 面板，含嵌套关系展开）

## 入口链

```
extensions/index.ts
  └─ export { default } from "../src/P4/index.ts"
      └─ registerRenderers(pi)
      └─ pi.registerTool(...) × 20+
      └─ pi.registerCommand("dteam", ...)
```

## 关键设计

### Worker Widget 多 worker 单行 + 嵌套 + 信号

折叠态 widget 支持**多个后台 worker 并行显示**，每行单 worker：
- 单行格式：`● build  实现功能  T:3 · edit  5.0s  📡`
- team/chain 子 worker 缩进 2 空格 + `↳`
- 信号角标：📡（progress）/ 🚧（blocked）/ 🔍（found）/ 🆘（help），可显示累计 ×N
- 状态栏极简计数：`N workers · M running`

### Worker Tab 面板（/dteam 触发）

折叠态外，dteam 提供**多 worker Tab 面板**，输入 `/dteam` 切换（再次输入关闭）：
- 多 worker Tab 栏（父 worker）：`[● w-1] [○ w-2] [✓ team-1]`，最多 10 个 tab，超出折叠为 `[+N more]`
- Tab 切换：`Tab` / `⇧Tab` / `←` / `→`
- 子 worker 详情：`Enter` 进入，`Esc` / `Tab` / `←` / `→` 返回父
- 关闭：`Esc` / `q` / `Ctrl+C`
- 嵌套区域：父 tab 内显示 `Nested workers (N):`，按 `chainIndex` 排序

数据流：wrapWorker 注入 `onProgress: (p) => updateAgentProgress(workerId, p)` 闭包 → 写 store → requestRender。
`P2/team.ts`/`P2/chain.ts` 通过 `bus.emit('progress', subWorkerId, { parentWorkerId, ... })` 注册子 worker 到 store，P4 `installSignalBridge` 自动桥接。
详见 [`README-worker-widget.md`](./README-worker-widget.md)。

### Model 注入

worker_create 时不指定 model 的情况下，自动注入当前会话模型：

1. `session_start` 事件触发时，从 `ctx.model` 读取当前模型并缓存
2. worker_create 调用时，如果用户没指定 model，从 dconfig 读取角色模型，fallback 到 ctx.model
3. fallbackModels 同理，从 dconfig 读取角色的 fallback 链

### options 归一化

Pi 工具 JSON 序列化层可能把数组变成 `{ item: ... }` 或普通对象，`normalizeOptions()` 统一收敛成 `WorkerOption[]`：

```typescript
// 输入变体
["a", "b"]           // 正常数组
{ item: ["a", "b"] }  // 包装对象
{ 0: "a", 1: "b" }    // 普通对象

// 输出
["a", "b"]           // 统一数组
```

### 自定义工具渲染（renderResult）

27 个 `pi.registerTool(...)` 全部补充 `renderResult`，沿用 pi 官方 `built-in-tool-renderer.ts` 模式——**默认一行概要 + `ctrl+o` 展开详情**，避免完整 JSON 挤占屏幕。

#### 三种渲染器

文件末尾定义 3 个项目内辅助函数（不导出）：

| 渲染器 | 适用工具 | 加工策略 |
|---|---|---|
| `makeTextRenderer(summaryFn)` | 20 个返回 JSON 的工具 | `JSON.parse` + `JSON.stringify(_, null, 2)` 美化；按 `\n` 拆行渲染 |
| `makeMarkdownRenderer(summaryFn)` | `task_read` / `reference_architecture`（返回 .md 内容） | 原样保留代码块/列表/标题/链接 |
| `makeWorkerRenderer()` | 5 个 `worker_*` | 默认显示 `buildBriefReport` 简要（中文简短）；展开显示 `details.full` 美化 JSON |

#### 状态与约定

- **流式态**：`isPartial=true` → `⏳ Processing…`
- **错误态**：`parsed.error` 存在 → `✗ {error摘要}`，与正常态视觉区分
- **折叠态**：概要行末尾追加 `(ctrl+o to expand)`，用 `keyHint("app.tools.expand", "to expand")` 输出（绑定 pi keybindings 配置）
- **展开态**：内容超过 30 行自动截断，末尾 `… (N more lines)`
- **wrapWorker return shape 扩展**：`{ content, details: { brief, full: parsedJson } }`——让 worker 工具的 renderResult 展开时能拿到原始 JSON

#### 27 个工具分布

- Markdown 渲染：2 个（`task_read`、`reference_architecture`）
- Text 渲染：20 个
- Worker 渲染：5 个（`worker_create` / `worker_start` / `worker_sendSignal` / `worker_cancel` / `worker_status`）

> 合计 27。参考官方 [extensions.md](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) 2030-2100 行的 `renderResult` API 规范。
### 自定义工具渲染（默认折叠 + ctrl+o 展开）

所有 27 个 dteam 工具（`task_*` / `memory_*` / `signal_*` / `worker_*` / `reference_*` / `dteam`）都提供 `renderResult`，不依赖 pi fallback（避免 dump 完整 JSON 挤占屏幕）：

- **默认一行概要 + `(ctrl+o to expand)` 提示**：用 `keyHint("app.tools.expand", "to expand")` 输出快捷键提示，跟用户 keybinding 配置走
- **`ctrl+o` 展开后**显示完整内容（JSON 美化或 Markdown 渲染）
- **错误态**用 `✗ {error}` 前缀，与正常态视觉区分
- **流式 partial 态**显示 `⏳ Processing...`

#### 渲染器选择

| 工具 | 渲染器 | 展开内容 |
|---|---|---|
| `task_read` | `Markdown` | `parsed.content` 字段（.md 文本）保留代码块 / 列表 / 标题 |
| `reference_architecture` | `Text` + beautifyJson | 美化 JSON |
| 其他 25 个工具 | `Text` + beautifyJson | 美化 JSON |

#### 辅助函数（项目内，不导出）

- `makeTextRenderer(summaryFn)` — Text 渲染器工厂
- `makeMarkdownRenderer(summaryFn)` — Markdown 渲染器工厂
- `makeWorkerRenderer()` — Worker 工具渲染器（用 `details.brief` / `details.full`）
- `truncate(text, max)` / `beautifyJson(raw)` / `expandLines(text, max)` / `getErrorSummary(parsed)` — 基础工具

#### 行数截断

展开态内容超过 30 行则截断，末尾追加 `… (N more lines)`。`task_read` 的 Markdown 渲染也走相同截断（先 `split('\n').slice(0, 30).join('\n')` 再 `new Markdown(...)`）。

#### wrapWorker 的 details 扩展

为支持 worker 工具的"展开显示原始 JSON"语义，`wrapWorker` 的 return shape 从 `details: undefined` 改为 `details: { brief, full: parsedJson }`。`brief` 是 `buildBriefReport` 生成的简短中文文本（默认显示），`full` 是原始 JSON（展开显示）。这是**纯增量**，对其他消费方零影响（其他代码只读 `result.content[0].text`）。
