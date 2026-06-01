# P0 — 原子层

> 不依赖其他层，只定义类型、配置和纯函数。

## 模块清单

| 文件 | 职责 |
|------|------|
| `config.ts` | WorkerConfig 定义、options 读取与归一化工具 |
| `dteamConfig.ts` | dteam 三层配置加载（内置 → 全域 → 项目），支持 useCurrentModel |
| `signal.ts` | 信号类型（progress/blocked/found/help）和策略类型定义 |
| `signalEvent.ts` | 信号事件类型 + TTL 工具（信息素层 P0 类型层） |
| `status.ts` | WorkerStatus 和 TaskStatus 类型定义 |
| `stateMachine.ts` | 任务状态转换验证（终态、合法转换） |
| `memory.ts` | MemoryAdapter 接口定义 |
| `atomic.ts` | 原子操作：atomicCommit（git add+commit）、atomicWrite（tmp+rename） |
| `auth.ts` | 认证相关类型：User、AuthConfig、TokenPayload、AuthResponse |
| `concurrency.ts` | 并发控制：mapWithConcurrencyLimit、withTimeout |
| `gateChecks.ts` | 门控检查：8 项准入检查 |
| `loopDetector.ts` | 循环检测：防止重复调用和渐进式参数变化 |
| `i18n.ts` | 国际化：locale 检测和翻译函数 |
| `reference.ts` | 参考数据查询：architecture（TOML 搜索） |
| `pathSafety.ts` | 路径安全：文件名净化、路径边界检查、memory 路径沙箱 |

## 依赖关系

```
本层不依赖任何其他层。
所有类型和纯函数在此定义，供上层使用。
```
