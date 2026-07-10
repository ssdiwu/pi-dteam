# dteam API 参考

> dteam 对外保持轻量：1 个工具 `dteam_dispatch` + 1 个命令 `/dteam`。
>
> 0008 重定位后：dteam 是模型分级路由执行层，单工具统一执行/验收/回退。
>
> ⚠️ **实施状态**：本文定义的是 0.7.0 目标 API 契约。当前 0.6.0 运行时仍暴露旧 `dteam` 工具并执行 Orchestrator Loop，`dteam_dispatch` 尚不可调用。

## 1. 工具：`dteam_dispatch`

`dteam_dispatch` 创建 fresh 进程内 worker session，按指定档位模型 + 思考 + 工具白名单执行任务，返回结果。

### 1.1 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `task` | `string` | ✅ | 任务描述（prompt，自包含——worker 看不到主对话） |
| `tier` | `"T1" \| "T2" \| "T3"` | ✅ | 模型档位（T1 思考 / T2 标准 / T3 快速） |
| `thinking?` | `"low" \| "medium" \| "high"` | 否 | 思考强度；默认跟随档位（T1高/T2中/T3低） |
| `tools?` | `string[]` | 否 | 工具白名单；默认回落档位配置 |

### 1.2 三种用法（执行/验收/回退都是它）

```ts
// 执行小任务（并行 = 主模型并发调用多个）
dteam_dispatch(task="并行修这 3 个独立 bug", tier="T3")
dteam_dispatch(task="...", tier="T3")
dteam_dispatch(task="...", tier="T3")

// fresh 验收（对抗主模型倾向）
dteam_dispatch(task="验收这个产出是否达标：...", tier="T1", tools=["read","grep","find","ls"])
// ↑ fresh session，不看主会话/方案出处

// 回退（小模型搞不定）
dteam_dispatch(task="重做这个任务：...", tier="T1")
```

**关键**：dispatch 创建的 worker 都是 fresh session（Logical Isolation），所以验收天然 fresh——不需要第二个工具。

## 2. 命令：`/dteam`

| 输入 | 行为 |
|---|---|
| `/dteam <task>` | 显式启动（提示主模型进入分级路由模式） |
| `/dteam` | toggle（切换）面板展开 / 折叠 |
| `/dteam close` | 关闭面板 |

## 3. 运行态观察

| 渠道 | 作用 |
|---|---|
| `/dteam` | 展开 / 关闭实时面板，看 dispatch 执行 + 各档位 worker |
| widget（小组件） | 执行中显示紧凑摘要（当前 dispatch、各档位 worker） |
| status（状态栏） | 显示 dteam 正在执行 |
| notify（通知） | 完成、失败、回退提示 |

## 4. 完成判定

dteam 没有独立的"完成判定"——主模型自己决定何时收口（它推进对话）。关键 task 主模型调 fresh 验收确认；不强制（A 形态要轻）。

## 5. 结果结构（0008 目标形态）

```ts
interface DispatchResult {
  status: "done" | "failed"
  tier: "T1" | "T2" | "T3"
  task: string
  result: string          // worker 产出
  model: string           // 实际使用的模型（含 fallback）
  fellBack?: boolean      // 是否触发回退
}
```

> 旧 `DteamResult6`（summonTrail + signalSnapshot + checkConclusion）随 Orchestrator Loop 一起退场。

## 6. `availableTools` 契约

| 场景 | 行为 |
|---|---|
| 主 LLM 传非空 `tools` | dispatch 只允许 worker 用这些工具 |
| 不传 | 回落到档位默认白名单 |
| 工具名不存在 | intersect（取交集）过滤 |

## 7. 内部 API（0008 改造方向）

| 函数 | 位置 | 说明 |
|---|---|---|
| dispatch 实现 | `src/leaf.ts` | 进程内 `createAgentSession` + Logical Isolation 执行 |
| `createWorkerSession(options)` | `src/session.ts` | 创建进程内 worker session + Multi-Provider Routing（按 tier） |
| 档位配置 | `src/session/role-config.ts` | T1/T2/T3 默认模型 + thinking + 工具白名单 |

> 0.6.0 的 `orchestrator-loop.ts` / `signals/*` 待退场（0008 推翻）。

## 8. 当前不提供的 API

| 不提供 | 原因 |
|---|---|
| 多个工具名 | 保持单工具哲学（dispatch 统一执行/验收/回退） |
| `runId` / 后台返回 | dteam 是主模型在对话里直接 dispatch，不后台运行 |
| 自定义角色/档位注册 | 三档写死（延续 ADR 0002 精神） |
| workflow 脚本 API | dteam 不做固定编排平台 |
| Orchestrator Loop / Signal Store | 已被 0008 推翻 |
