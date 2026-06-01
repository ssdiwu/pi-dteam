# P4 — 用户接口层

> 依赖 P0-P3，提供 Pi 扩展入口和 TUI 渲染。

## 模块清单

| 文件 | 职责 |
|------|------|
| `index.ts` | 扩展入口：注册 21+ 工具、`/dteam` 命令 |
| `dteamTool.ts` | dteam 调度入口工具：list/plan/run/status 4 个 action |
| `renderers.ts` | TUI 渲染：worker 进度消息渲染、底部状态栏 |
| `worker-widget.ts` | Worker 状态 Widget：折叠态（bordered box）+ 展开态（全屏覆盖层，Ctrl+O 切换） |

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

- `/dteam` — 显示 dteam 状态

## 入口链

```
extensions/index.ts
  └─ export { default } from "../src/P4/index.ts"
      └─ registerRenderers(pi)
      └─ pi.registerTool(...) × 20+
      └─ pi.registerCommand("dteam", ...)
```

## 关键设计

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