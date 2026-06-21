# session/

worker session（工作者会话）的创建和角色配置。核心是 `createWorkerSession` 工厂——装配 resourceLoader + tools + customTools，调 Pi SDK 的 `createAgentSession`。

## 文件

| 文件 | 职责 |
|---|---|
| `role-config.ts` | `ROLE_DEFAULTS`：5 个角色的工具 / thinking / description（写死，见 ADR 0002） |
| `role-prompt.ts` | 角色对应 `agents/*.md` 的 prompt 加载 |
| `model-resolver.ts` | worker 模型解析（`pickAvailableModel` 默认复用主模型；`resolveModelStr` 解析 "provider/id"） |
| `resource-loader.ts` | 资源 / 工具加载；Logical Isolation 时跳过 `discoverAndLoadExtensions` |
| `signal-tool.ts` | `worker_sendSignal` customTool 定义，让 worker 能上报信号 |

## 关系

被 `leaf/` 调用创建 worker session；`role-config.ts` 是工具权限矩阵的运行时权威（见 `doc/10-架构与运行/11-角色系统.md` 第 3 节）。

## 0.6.0 关键点

- **Logical Isolation**（ADR 0005 第 11 条）：`logicalIsolation: true` 时用 `makeResourceLoader(systemPrompt)` 不加载扩展，worker session 保持 fresh（不继承主会话扩展工具，只载角色 prompt + 工具白名单 + customTools）。
- **customTools 必须并入 tools 白名单**：Pi SDK 的 `createAgentSession` 只把出现在 `tools` 白名单里的 customTool 激活给 LLM。`createWorkerSession` 自动把 customTools 的 name 合并进 `tools`，否则 LLM 看不到这些工具（这是 glm-5.2 最初不调 `orchestrator_decide` 的根因）。

详见 ADR 0005（召唤池重定义）。