# P4 — 用户接口层

> 依赖 P0-P3，提供 Pi 扩展入口和 TUI 渲染。

## 模块清单

| 文件 | 职责 |
|------|------|
| `index.ts` | 扩展入口：注册 21+ 工具、`/dteam` 命令 |
| `dteamTool.ts` | dteam 调度入口工具：list/plan/run/status 4 个 action |
| `renderers.ts` | TUI 渲染：worker 进度消息渲染、底部状态栏 |

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