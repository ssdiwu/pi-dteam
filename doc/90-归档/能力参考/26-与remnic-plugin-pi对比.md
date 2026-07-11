# 与 @remnic/plugin-pi 对比

> 调研记录。本节只做范式对比和"轻 / 重"评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](../../30-路线图/30-项目路线图.md)**。

- 来源：[https://pi.dev/packages/@remnic/plugin-pi](https://pi.dev/packages/@remnic/plugin-pi)
- v9.3.613，148.8 KB
- **6,153 下载/月**（这批调研里下载量最大）
- 作者：joshuaswarren
- 借鉴参考：ant-colony

## 一句话

@remnic/plugin-pi 是 **Remnic 长期记忆 daemon 的 Pi 集成**：在 `context` hook 里 recall 上下文、观察 session 事件、协调 Pi compaction 和 Remnic 的 long-context memory archive。给"跨 session 长期记忆"用的。

## 核心机制

### Remnic 架构

- **远程 daemon**：`http://127.0.0.1:4318`（Remnic 跑在本地）
- **作用**：长期记忆 archive + 跨 session 上下文 recall
- **安装**：通过 Remnic CLI 自动写 Pi 扩展文件到 `~/.pi/agent/extensions/remnic/`

### 这个插件做什么

| 行为 | 触发点 | 描述 |
|------|--------|------|
| Recall 上下文 | `context` hook | 在 agent turn 前 recall 相关 Remnic context |
| 观察消息 | session events | 记录 user / assistant / tool 消息（`sourceFormat: "pi"`） |
| Compaction 协调 | Pi compaction | Pi 压缩前 flush Remnic long-context memory |
| 记录 checkpoints | Pi compaction | 记录 compaction checkpoints + token deltas |
| 注册 MCP 工具 | extension 注册 | 把 Remnic MCP 工具注册为 Pi 工具 |
| 去重 | Pi custom entries | 重复 turn 不重复 observe |

### 配置

```json
{
  "remnicDaemonUrl": "http://127.0.0.1:4318",
  "namespace": "work",
  "recallMode": "auto",
  "recallTopK": 8,
  "recallBudgetChars": 12000,
  "recallEnabled": true,
  "observeEnabled": true,
  "compactionEnabled": true,
  "mcpToolsEnabled": true,
  "statusEnabled": true,
  "requestTimeoutMs": 60000
}
```

### 安全设计

- Remnic 路由用 active Pi session key + cwd + namespace
- MCP tool calls strip 调方提供的 `sessionKey` / `namespace` / `cwd`
- 配置文件用 0600 权限
- 无效配置 fail closed
- 默认 daemon URL 本地（`http://127.0.0.1:4318`）

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> **轻**：—
> **重**：依赖外部 daemon
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。

**@remnic/plugin-pi 本身是"Pi + 外部服务" 架构**。dteam 当前是**纯 in-process**（共享 `modelRegistry.authStorage`，不连外部服务）。

**dteam 不集成 Remnic**。原因：
- 引入外部 daemon 依赖 = dteam 变重
- dteam 跨 session 需求不强（每个 dteam run 是独立 goal，不需"昨天在做什么"）
- dteam 已经有自己的 `signalBus` + `runsStore`（内存版"事件流"）

## 与 dteam 的关系

dteam 当前跨 session 行为：
- in-memory：进程崩了全没（**已知限制**）
- 多 run：每个 dteam 调用是独立 run（通过 `runId` 区分）
- 多 session：靠主 LLM 的 session 管理（dteam 不参与）

Remnic 提供的能力是**"跨 session 长期记忆"**——dteam 当前不需要。

但**dteam 用户可以同时装 Remnic**：
- dteam 是 Pi 扩展，Remnic 是另一个 Pi 扩展
- 两者不冲突（各自注册不同 hook）
- Remnic 可以在主 LLM 上下文里 recall，dteam 派 worker 干活——协同

## 借鉴价值

✅ **无核心概念可借鉴**——dteam 跨 session 需求不强，dteam 用户已可通过主 LLM session 管理跨 run。

⚠️ **可观察的设计模式**（但不直接借鉴）：
- 配置文件 0600 权限（dteam 配置文件 `~/.pi/agent/settings.json` 也应 0600，**这条 dteam 当前未必做**）
- 无效配置 fail closed（dteam `src/config.ts` 失败时是 throw + 停，符合 fail closed）
- 调方提供参数 strip（dteam `SignalBus` 的 workerId 由 root 注入，不让 worker 自己造，符合此模式）

## 借鉴清单

| 项 | 范围 | 状态 | 备注 |
|----|------|------|------|
| 集成 Remnic | — | 不做 | 依赖外部 daemon，dteam 变重 |
| 借鉴概念 | — | 无 | 跨 session 需求不强 |

## 不要学

- ❌ 引入外部 daemon 依赖（dteam 纯 in-process）
- ❌ context hook recall（dteam 跨 session 需求不强）
- ❌ Pi compaction 协调（dteam `compaction: { enabled: false }`）
- ❌ MCP 工具注册（dteam 已用 `customTools` API）
- ❌ namespace / recallMode 等配置维度（dteam 配置集中在 `src/config.ts`）

## 关键不变量（dteam 必须保留）

1. **纯 in-process**（不依赖外部 daemon）
2. **共享 `modelRegistry.authStorage`**（不外泄 API key）
3. **`compaction: { enabled: false }`**（不主动压缩）
4. **配置集中在 `src/config.ts`**（不引入外部 config 文件）
5. **tool 名 `dteam` 单一**（不增加 `remnic_*` 工具）

## 可共存

dteam 用户可以**同时装 Remnic + dteam**：
- Remnic 给主 LLM 提供跨 session 长期记忆
- dteam 派 worker 跑具体任务
- 两者不冲突
- 适合场景：dteam 跑大量项目，希望主 LLM 能"记得上次在做什么"——但这个**不是 dteam 的职责**

## 参考实现位置

- npm 包：`@remnic/plugin-pi`
- 仓库：github.com/joshuaswarren/remnic
- 关键文件：`./dist/index.js`（入口）
- Remnic 仓库：见上述 github
- 完整集成文档：github.com/joshuaswarren/remnic/blob/main/docs/integration/pi.md
