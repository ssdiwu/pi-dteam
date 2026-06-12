# dteam API 参考

> dteam 对外保持轻量：1 个工具 `dteam` + 1 个命令 `/dteam` + 1 类完成消息 `dteam-report`。

## 1. 工具：`dteam`

`dteam` 让主 LLM 启动或继续一次后台多 worker 协作。

### 1.1 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|:---:|---|
| `action` | `"run" | "continue"` | ✅ | `run` 启动后台任务；`continue` 给等待中的任务注入用户补充 |
| `goal` | `string` | `run` 时必填 | 要完成的目标 |
| `runId` | `string` | `continue` 时必填 | 后台任务 ID（编号） |
| `message` | `string` | `continue` 时必填 | 用户补充信息 |
| `availableTools` | `string[]` | 否 | 主 LLM 当前可见工具名列表；dteam 用它校验和透传 worker 工具 |

### 1.2 启动后台任务

```ts
dteam(
  action="run",
  goal="重构 src/ui/panel.ts，让完成项不堆积",
  availableTools=["read", "bash", "edit", "write", "grep", "find", "ls"]
)
```

立即返回：

```json
{ "status": "running", "runId": "run-xxx" }
```

注意：这只是启动确认，不是最终结果。

### 1.3 继续等待中的任务

```ts
dteam(
  action="continue",
  runId="run-xxx",
  message="保留现有中文 UI，不要引入英文状态名"
)
```

返回：

```json
{ "content": "已注入到 run run-xxx，叶子继续执行" }
```

## 2. 运行态观察

`run` 返回后，进度不通过 `onUpdate`（流式更新回调）继续推送。观察方式：

| 渠道 | 作用 |
|---|---|
| `/dteam` | 展开 / 关闭实时面板 |
| widget（小组件） | run 进行中自动显示紧凑摘要 |
| status（状态栏） | 显示 dteam 正在执行 |
| notify（通知） | 开始、完成、失败提示 |
| `dteam-report` | 完成后进入主对话的最终报告 |

## 3. 命令：`/dteam`

| 输入 | 行为 |
|---|---|
| `/dteam` | toggle（切换）面板展开 / 折叠 |
| `/dteam 0` | 展开并切到总览 tab（标签页） |
| `/dteam 1` | 展开并切到第 1 个 worker tab |
| `/dteam close` | 关闭面板 |

空态示例：

```text
📊 dteam worker 进度
──────────────────────
  （无 worker 正在工作）

  启动 worker：让主 LLM 调 dteam(action="run", goal="...")
──────────────────────
```

运行态示例：

```text
⚙ dteam · 修复 UI 状态 · 00:12 · 1/3 完成
[0:总览] [1:W:build] [2:W:check]
──────────────────────
  目标: 修复 UI 状态
  耗时: 00:12  1/3 完成, 2 在跑
  计划: chain · 先实现后验收

  ⚒ build: 调整 panel 清理逻辑
    ⎿ 已更新 store 状态
```

## 4. 完成消息：`dteam-report`

后台 run 完成后，扩展会发送一条 `dteam-report` 自定义消息：

折叠态：

```text
✓ dteam · 3/3 完成 (Ctrl+O 展开)
```

展开态显示每个 step 的角色、状态和输出摘要。

## 5. 最终结果结构

内部最终结果仍是 `RunResult`：

```ts
interface RunResult {
  status: "done" | "failed"
  goal: string
  plan: ExecutionPlan
  steps: StepResult[]
  summary: string
  signals?: Signal[]
  workers?: WorkerRun[]
  taskSummary?: { total: number; done: number; failed: number }
}
```

`ExecutionPlan`：

```ts
interface ExecutionPlan {
  mode: "solo" | "chain" | "team"
  reason: string
  steps: PlanStep[]
}

interface PlanStep {
  role: "explore" | "design" | "build" | "check" | "close"
  task: string
  strategy: "direct" | "build_check" | "adaptive"
  files?: string[]
  tools?: string[]
}
```

## 6. `availableTools` 契约

| 场景 | 行为 |
|---|---|
| 主 LLM 传非空数组 | planner LLM 路径只允许选择这些工具 |
| 不传 | 回落到 `ROLE_DEFAULTS` |
| 传空数组 | 等同不传 |
| LLM 返回不存在的工具名 | intersect（取交集）过滤；全空则回落默认工具 |

这来自 `41-工具动态加载方案.md` 的方案 D：dteam 不扫描 Pi 已加载工具，而是信任调用方显式传入。

## 7. 内部 API

| 函数 | 位置 | 说明 |
|---|---|---|
| `run(goal, ctx)` | `src/orchestrator.ts` | 执行一次 goal，返回 `RunResult` |
| `plan(goal, ctx, availableTools?)` | `src/planner.ts` | 生成 `ExecutionPlan` |
| `execute(role, task, ctx, goal, tools?)` | `src/leaf.ts` | 执行单个 worker step |
| `createWorkerSession(options)` | `src/session.ts` | 创建 worker session |
| `getRoleTools(role)` | `src/session/role-config.ts` | 获取角色默认工具 |

## 8. 当前不提供的 API

| 不提供 | 原因 |
|---|---|
| `status` action | 当前状态通过 `/dteam` 面板和最终 report 呈现；未来如确有需要再加 |
| 多个工具名 | 保持 dteam 单工具哲学 |
| 自定义角色注册 API | 角色写死是当前简化策略 |
| workflow 脚本 API | dteam 不做固定编排平台 |
