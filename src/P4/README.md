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