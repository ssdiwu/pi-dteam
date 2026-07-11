# session/

`createWorkerSession()` 创建单次 dispatch 使用的进程内 fresh `AgentSession`。每个 worker 有独立 `SessionManager.inMemory()`；`logicalIsolation: true` 时只使用最小 ResourceLoader，不发现或继承主会话扩展。

| 文件 | 职责 |
|---|---|
| `tier-config.ts` | T1/T2/T3 默认 prompt、thinking、工具白名单；读取 `DTEAM_T*_MODEL` 与 `_FALLBACK_MODELS` |
| `model-resolver.ts` | 解析 `provider/id` 到 Pi `Model` |
| `resource-loader.ts` | system prompt 与受控扩展资源加载 |

调用方的 `builtInTools` 覆盖档位默认；`customTools` 名称会自动加入工具白名单。角色 prompt、信号 custom tool 和 worker role 配置已随 0.6 runtime 删除。
