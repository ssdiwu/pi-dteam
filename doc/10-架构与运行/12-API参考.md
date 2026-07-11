# dteam API 参考

> dteam 对外只保留 1 个工具：`dteam_dispatch`。
>
> 0008 重定位后：dteam 是模型分级路由执行层，单工具统一执行/验收/回退。
>
> **实施状态**：`leaf.ts` / `session.ts` 的 0.7 fresh dispatch 内核、唯一入口与自动化测试均已完成；0.6 loop/signal/UI 已删除。

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

## 2. 运行态观察

| 渠道 | 作用 |
|---|---|
| 工具结果 | `dteam_dispatch` 将结构化 DispatchResult 返回主对话 |
| status（状态栏） | 执行期间显示当前 tier 与 task，结束后清理 |
| notify（通知） | 完成或失败提示；成功回退由返回结果的 `fellBack` 字段表达，不单独通知 |

## 3. 完成判定

dteam 没有独立的"完成判定"——主模型自己决定何时收口（它推进对话）。关键 task 主模型调 fresh 验收确认；不强制（A 形态要轻）。

## 4. 结果结构（dispatch 内核当前契约）

```ts
interface DispatchResult {
  status: "done" | "failed"
  task: string
  requestedTier: "T1" | "T2" | "T3" // 调用方请求的档位
  tier: "T1" | "T2" | "T3"          // 实际完成/最终尝试的档位
  thinking: "low" | "medium" | "high"
  tools: string[]                      // 实际权限白名单
  result: string                       // worker 产出；失败时为空
  model?: string                       // 实际使用的 provider/id
  fellBack: boolean                    // 是否已尝试更强档位
  attempts: Array<{ tier: "T1" | "T2" | "T3"; model?: string; error?: string }>
  error?: string
  elapsedMs: number
}
```

> 旧 `DteamResult6`（summonTrail + signalSnapshot + checkConclusion）随 Orchestrator Loop 一起退场。

## 5. 档位模型配置

| 环境变量 | 作用 |
|---|---|
| `DTEAM_T1_MODEL` / `T2` / `T3` | 显式指定该档主模型，格式 `provider/id` |
| `DTEAM_T1_FALLBACK_MODELS` / `T2` / `T3` | 逗号分隔的同档 provider 回退链 |

未配置 primary 时才回落当前 `ctx.model`；不按模型名称或价格猜档。回退到 T1 后默认恢复 T1 高思考。

## 6. `tools` 契约

| 场景 | 行为 |
|---|---|
| 主 LLM 传非空 `tools` | dispatch 只允许 worker 用这些工具 |
| 不传 | 采用**请求档**默认白名单，并作为同档 fallback 与 T1 回退的上限（T3 仍只读） |
| 工具名不存在 | intersect（取交集）过滤 |

## 7. 内部 API（已完成的 dispatch 内核）

| 函数 | 位置 | 说明 |
|---|---|---|
| `dispatch(request, ctx)` | `src/leaf.ts` | 已实现：进程内 fresh session、Logical Isolation、同档 provider fallback 与非 T1→T1 硬回退 |
| `createWorkerSession(options)` | `src/session.ts` | 已支持 `tier` + thinking，继续创建进程内 worker session |
| 档位配置 | `src/session/tier-config.ts` | 已实现：T1/T2/T3 默认模型路由、thinking、工具白名单 |
| 路由 / 并发 | `src/dispatch/*` | 已迁移：显式模型链与 Adaptive Concurrency；不创建执行 loop |

> 0.6.0 的 `orchestrator-loop.ts` / `signals/*` 已删除（0008 推翻）。

## 8. 当前不提供的 API

| 不提供 | 原因 |
|---|---|
| 多个工具名 | 保持单工具哲学（dispatch 统一执行/验收/回退） |
| `runId` / 后台返回 | dteam 是主模型在对话里直接 dispatch，不后台运行 |
| 自定义角色/档位注册 | 三档写死（延续 ADR 0002 精神） |
| workflow 脚本 API | dteam 不做固定编排平台 |
| Orchestrator Loop / Signal Store | 已被 0008 推翻 |
