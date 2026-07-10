# session/

worker session（工作者会话）的创建和角色配置。核心是 `createWorkerSession` 工厂——装配 resourceLoader + tools + customTools，调 Pi SDK 的 `createAgentSession`。

## 文件

| 文件 | 职责 |
|---|---|
| `tier-config.ts` | 0.7 档位默认：T1/T2/T3 的 thinking、工具白名单和独立 prompt；T3 默认只读 |
| `role-config.ts` | 0.6 五角色工具 / thinking / description；旧 loop 退场前的兼容遗留 |
| `role-prompt.ts` | 0.6 角色对应 `agents/*.md` 的 prompt 加载；待五角色退场 |
| `model-resolver.ts` | worker 模型解析（`pickAvailableModel` 默认复用主模型；`resolveModelStr` 解析 "provider/id"） |
| `resource-loader.ts` | 资源 / 工具加载；Logical Isolation 时跳过 `discoverAndLoadExtensions` |
| `signal-tool.ts` | `worker_sendSignal` customTool 定义，让 worker 能上报信号 |

## 关系

被 `leaf/` 调用创建 worker session；0.7 dispatch 的工具权限运行时权威是 `tier-config.ts`，旧 `role-config.ts` 仅供 0.6 loop 过渡使用。

## 0.6.0 关键点

- **Logical Isolation**（ADR 0005 第 11 条）：`logicalIsolation: true` 时用 `makeResourceLoader(systemPrompt)` 不加载扩展，worker session 保持 fresh（不继承主会话扩展工具，只载角色 prompt + 工具白名单 + customTools）。
- **customTools 必须并入 tools 白名单**：Pi SDK 的 `createAgentSession` 只把出现在 `tools` 白名单里的 customTool 激活给 LLM。`createWorkerSession` 自动把 customTools 的 name 合并进 `tools`，否则 LLM 看不到这些工具（这是 glm-5.2 最初不调 `orchestrator_decide` 的根因）。

详见 ADR 0005（召唤池重定义）。