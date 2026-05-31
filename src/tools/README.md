# tools — 工具实现

> Pi 扩展注册的工具函数，供 LLM 调用。

## 模块清单

| 文件 | 职责 |
|------|------|
| `task.ts` | task CRUD：create/read/update/complete/archive/list/search |
| `worker.ts` | worker 管理：create/start/sendSignal/cancel/status/saveMemory/loadMemory/getMemory |
| `memory.ts` | 共享内存操作：get/set/keys/has/delete/clear/save/load |
| `signal.ts` | 信号操作：emit/history |
| `auth.ts` | 认证操作：register/login/verify/refresh/logout |
| `reference.ts` | 参考数据查询：architecture（TOML 搜索） |
| `pathSafety.ts` | 路径安全：文件名净化、路径边界检查、memory 路径沙箱 |

## 工具注册

所有工具在 `src/extension/index.ts` 中通过 `pi.registerTool()` 注册。

## 安全约束

- `memory_save/load` 和 `worker_saveMemory/loadMemory` 只能读写 `.dteam/memory/*.json`
- `task_create` 文件名会被净化，防止路径穿越
- `task_read/update` section 解析不使用正则拼接，防止注入
- `signal_emit` 校验信号类型枚举
