# session/

`createWorkerSession()` 创建单次 dispatch 使用的进程内 fresh `AgentSession`。每个 worker 有独立 `SessionManager.inMemory()`；`logicalIsolation: true` 时只使用最小 ResourceLoader，不发现或继承主会话扩展。

| 文件 | 职责 |
|---|---|
| `model-candidate.ts` | `provider/model[:thinking]` 的唯一后缀解析与基础引用校验 |
| `tier-config.ts` | T1/T2/T3 默认 prompt、thinking、工具白名单；把候选解析结果与档位默认值合并 |
| `model-config.ts` | 加载并校验 `~/.pi/agent/pi-dteam.json` 的 T1/T2/T3 模型候选链 |
| `model-resolver.ts` | 解析 `provider/id` 到 Pi `Model` |
| `resource-loader.ts` | system prompt 与受控扩展资源加载 |

调用方的 `builtInTools` 覆盖档位默认；`customTools` 名称会自动加入工具白名单。模型配置使用 `~/.pi/agent/pi-dteam.json` 的有序候选数组，后续候选作为回退。角色 prompt、信号 custom tool 和 worker role 配置已随 0.6 runtime 删除。
