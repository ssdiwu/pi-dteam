# extension — Pi 扩展入口

> 注册所有工具、命令、渲染器，是 dteam 与 Pi 的对接层。

## 模块清单

| 文件 | 职责 |
|------|------|
| `index.ts` | 扩展入口：注册 20+ 工具、`/dteam` 命令 |
| `renderers.ts` | TUI 渲染：worker 进度消息渲染、底部状态栏 |

## 注册的工具

| 类别 | 工具 |
|------|------|
| Task | task_create/read/update/complete/archive/list/search |
| Worker | worker_create/start/sendSignal/cancel/status/saveMemory/loadMemory/getMemory |
| Memory | memory_get/set/keys/has/delete/clear/save/load |
| Auth | auth_register/login/verify/refresh/logout |
| Signal | signal_emit/history |
| Reference | reference_architecture |

## 注册的命令

- `/dteam` — 显示 dteam 状态

## 入口链

```
extensions/index.ts
  └─ export { default } from "../src/extension/index.ts"
      └─ registerRenderers(pi)
      └─ pi.registerTool(...) × 20+
      └─ pi.registerCommand("dteam", ...)
```
