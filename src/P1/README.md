# P1 — 分子层

> 依赖 P0，提供服务实现。

## 模块清单

| 文件 | 职责 |
|------|------|
| `signalBus.ts` | 信号总线：emit/on/getHistory，进程内实时通信 |
| `sharedMemory.ts` | 基础共享内存：namespace 隔离的 key-value 存储 |
| `enhancedSharedMemory.ts` | 增强共享内存：持久化、批量操作、历史追踪、快照 |
| `authService.ts` | 认证服务：注册、登录、token 签发与验证、refresh token |
| `backgroundWorker.ts` | 后台 Worker：不阻塞主进程的异步执行 |
| `spawn.ts` | 子代理运行：调 Pi SDK `createAgentSession` 启子 session 调真 LLM（7 步：auth/registry → model+fallback → resourceLoader → createSession → 订阅事件 → 发 prompt → 返回 result） |
| `i18n.ts` | 国际化翻译表：中英文工具名和状态翻译 |
| `compaction.ts` | 消息压缩：历史消息压缩和摘要 |
| `task.ts` | task CRUD 工具：create/read/update/complete/archive/list/search |
| `memory.ts` | 共享内存操作工具：get/set/keys/has/delete/clear/save/load |
| `signal.ts` | 信号操作工具：emit/history |
| `auth.ts` | 认证操作工具：register/login/verify/refresh/logout |

## 依赖关系

```
P1 → P0
```

## 关键设计

- **SignalBus** 是进程内单例，所有 worker 共享同一个实例
- **EnhancedSharedMemory** 是进程内单例，支持 save/load 持久化到 `.dteam/memory/`
- **AuthService** 使用 scrypt 哈希密码、HMAC-SHA256 签名 token
- **spawnAgent**（`spawn.ts`）导出 9 字段 `SpawnOptions`（含 `cwd`/`fallbackModels`/`sessionModel`），走 7 步模式；fallback 链超过 5 个会被截断并 warn；错误分类用 `MODEL_ERROR_PATTERNS` 正则匹配 429/rate limit/auth/timeout；maxRetries=3