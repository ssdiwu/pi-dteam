# dteam API 参考

> dteam 对外保持轻量：1 个工具 `dteam` + 1 个命令 `/dteam`。
>
> 0.6.0 重定义后，dteam 是**同步前台**执行（Orchestrator Loop），不再后台运行、不再返回 `runId`（推翻 [ADR 0003](../adr/0003-后台运行依附Extension-Runtime而非单次tool-call.md)）。

## 1. 工具：`dteam`

`dteam` 让主 LLM 拉起一次 Orchestrator Loop（编排循环），进入群策群力协作。

工具 description（描述）内置触发协议摘要：需要群策群力（召唤多个专业角色）的复杂任务应调 dteam；普通问答、单文件小改、只跑一个命令、单兵能干的任务不应调用。完整规则见 `14-dteam触发协议.md`。

### 1.1 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `goal` | `string` | ✅ | 要完成的目标 |
| `availableTools` | `string[]` | 否 | 主 LLM 当前可见工具名列表；dteam 用它校验和透传 worker 工具 |

> 0.6.0 后移除了 `action="run"` / `action="continue"` / `runId` 参数。启动 = 直接传 goal 进入同步前台 Orchestrator Loop。

### 1.2 拉起 Orchestrator Loop

```ts
dteam(
  goal="为 src/orchestrator.ts 实现 0.6.0 Orchestrator Loop 主循环",
  availableTools=["read", "bash", "edit", "write", "grep", "find", "ls"]
)
```

进入同步前台执行：阻塞主对话，Orchestrator 循环召唤 worker、收信号、直到 `check` 收口完成，返回最终报告。

> 注意：不再立即返回 `{status:"running", runId}`。同步前台意味着 dteam 期间主对话阻塞。

## 2. 运行态观察

Orchestrator Loop 推进期间，通过以下渠道实时观察（同步前台，进度随循环可见）：

| 渠道 | 作用 |
|---|---|
| `/dteam` | 展开 / 关闭实时面板，看 Orchestrator Loop 推进 + Signal Store 快照 |
| widget（小组件） | loop 进行中显示紧凑摘要（当前召唤的 worker、关键信号） |
| status（状态栏） | 显示 dteam 正在执行 |
| notify（通知） | 开始、收口、失败提示 |

## 3. 命令：`/dteam`

| 输入 | 行为 |
|---|---|
| `/dteam <goal>` | 显式启动 Orchestrator Loop（启动方式 C 混合之一） |
| `/dteam` | toggle（切换）面板展开 / 折叠 |
| `/dteam close` | 关闭面板 |

## 4. 完成判定：Completion Gate（收口闸门）

Orchestrator Loop 不自行判定完成；goal 完成前必须召唤 `check` 角色通过收口（ADR 0005 第 14 条）。`check` pass 后，Orchestrator Loop 结束，返回最终报告。

## 5. 最终结果结构（0.6.0 重定义后形态）

> 注：0.6.0 代码已落地——`src/` 已重写为 Orchestrator Loop（`orchestrator-loop.ts`）+ SignalStore + 强制 check 收口，返回 `DteamResult6`（召唤轨迹 + signalSnapshot + checkConclusion）。旧 `RunResult.plan+steps` / `ExecutionPlan.mode` 已删。

```ts
// 0.6.0 目标形态（代码改造方向）
interface DteamResult {
  status: "done" | "failed"
  goal: string
  summonTrail: SummonStep[]      // 召唤轨迹（事中涌现记录）
  signalSnapshot: Signal[]       // Signal Store 最终快照
  checkConclusion: CheckResult   // check 收口结论
  summary: string
}

interface SummonStep {
  role: "explore" | "design" | "build" | "check" | "close"
  task: string
  result: string
  signals: Signal[]
  model: string                  // 实际使用的模型（含 fallback）
}
```

## 6. `availableTools` 契约

| 场景 | 行为 |
|---|---|
| 主 LLM 传非空数组 | Orchestrator 召唤 worker 时只允许选择这些工具 |
| 不传 | 回落到 `ROLE_DEFAULTS` |
| 传空数组 | 等同不传 |
| 工具名不存在 | intersect（取交集）过滤；全空则回落默认工具 |

这来自工具动态加载方案 D：dteam 不扫描 Pi 已加载工具，而是信任调用方显式传入。

## 7. 内部 API（0.6.0 重写方向）

| 函数 | 位置 | 说明 |
|---|---|---|
| Orchestrator Loop 主循环 | `src/orchestrator.ts` | 读 Signal Store → LLM 驱动决策 → 召唤 worker → 收信号 → 继续/收口 |
| 召唤单个 worker | `src/leaf.ts` | 进程内 `createAgentSession` + Logical Isolation 执行 |
| `createWorkerSession(options)` | `src/session.ts` | 创建进程内 worker session + Multi-Provider Routing |
| `getRoleTools(role)` | `src/session/role-config.ts` | 获取角色默认工具 |

> 当前 `src/planner.ts`（穷举式 planner）将在 0.6.0 被 Orchestrator Loop 内的每轮 LLM 调用取代；`src/scheduler/*`（FileGraph / preflight）将降级为 Orchestrator 决策辅助。

## 8. 当前不提供的 API

| 不提供 | 原因 |
|---|---|
| `runId` / 后台返回 | 0.6.0 改为同步前台 Orchestrator Loop（ADR 0005 推翻 ADR 0003） |
| `action="continue"` | 同步前台执行，不再有"等待补充"的后台注入；help 自愈走进程内 explore |
| 多个工具名 | 保持 dteam 单工具哲学 |
| 自定义角色注册 API | 角色写死（ADR 0002） |
| workflow 脚本 API | dteam 不做固定编排平台 |
