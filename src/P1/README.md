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
| `spawn.ts` | 子代理运行：通过 Pi SDK createAgentSession 运行子代理 |
| `i18n.ts` | 国际化翻译表：中英文工具名和状态翻译 |

## 依赖关系

```
P1 → P0
```

## 关键设计

- **SignalBus** 是进程内单例，所有 worker 共享同一个实例
- **EnhancedSharedMemory** 是进程内单例，支持 save/load 持久化到 `.dteam/memory/`
- **AuthService** 使用 scrypt 哈希密码、HMAC-SHA256 签名 token
