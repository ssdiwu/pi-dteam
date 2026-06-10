# dteam API 参考

> dteam 对外暴露 1 个工具 + 1 个命令。

## 工具：`dteam`

让主 LLM 以**后台任务模式**启动或继续一个 goal（目标）。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `action` | `"run" \| "continue"` | ✅ | `run`=启动后台任务；`continue`=给等待中的任务继续注入信息 |
| `goal` | `string` | `run` 时必填 | 要完成的目标（自由文本） |
| `runId` | `string` | `continue` 时必填 | 后台任务 ID |
| `message` | `string` | `continue` 时必填 | 用户补充给后台任务的信息 |
| `availableTools` | `string[]` | 否 | 主 LLM 传入的可用工具列表；用于 worker 工具验证与透传 |

### 调用示例

```typescript
// 启动后台任务
dteam(action="run", goal="在 /tmp 下创建 hello.txt")

// 继续一个等待人工输入的任务
dteam(action="continue", runId="run-xxx", message="请改 Web 端")
```

### 返回值

#### `action="run"`

立即返回：

```json
{ "status": "running", "runId": "run-xxx" }
```

说明：

- 这是**后台启动确认**，不是最终执行结果
- 实时进度请看 `/dteam`
- 最终结果会通过 `dteam-report`（结果报告）消息进入主对话

#### `action="continue"`

返回确认文本，例如：

```json
{ "content": "已注入到 run run-xxx，叶子继续执行" }
```

#### 最终结果结构

后台任务完成后，最终结果在内部仍是 `RunResult`：

```typescript
interface RunResult {
  status: "done" | "failed"
  goal: string
  plan: ExecutionPlan
  steps: StepResult[]
  summary: string
}

interface ExecutionPlan {
  mode: "solo" | "chain" | "team"
  steps: PlanStep[]
  reason: string
}

interface PlanStep {
  role: "explore" | "design" | "build" | "check" | "close"
  task: string
  strategy: "direct" | "build_check" | "adaptive"
  files?: string[]
}

interface StepResult {
  role: RoleName
  task: string
  strategy: Strategy
  status: "done" | "failed"
  output: string
  rounds?: number  // build_check / adaptive 实际跑的轮次
}
```

### 真实返回示例

#### 启动返回示例

```json
{
  "status": "running",
  "runId": "run-123"
}
```

#### 最终 `RunResult` 示例

```json
{
  "status": "done",
  "goal": "在 /tmp 下创建 hello.txt",
  "plan": {
    "mode": "solo",
    "reason": "目标简短，直接干",
    "steps": [{
      "role": "build",
      "task": "在 /tmp 下创建 hello.txt",
      "strategy": "direct"
    }]
  },
  "steps": [{
    "role": "build",
    "task": "在 /tmp 下创建 hello.txt",
    "strategy": "direct",
    "status": "done",
    "output": "完成。文件已创建..."
  }],
  "summary": "1/1 完成"
}
```

## 命令：`/dteam`

切换 dteam 进度面板。

### 行为

| 当前状态 | 输入 `/dteam` 后 |
|---------|-----------------|
| 无 run，面板关闭 | 打开空态面板 |
| 有 run，面板关闭 | 打开进度面板 |
| 面板打开 | 关闭面板 |

### 面板内容

> `v0.4.1` 起，后台实时进度以 `/dteam` 面板为主，不再依赖已结束工具调用的流式更新。

**空态**（无 run）：

```
📊 dteam worker 进度
──────────────────────
  （无 worker 正在工作）

  启动 worker：让主 LLM 调 dteam(action="run", goal="...")

──────────────────────
  再输 /dteam 关闭面板
```

**进度态**（有 run）：

```
📊 dteam · <goal> · <duration> · <done>/<total> 完成
──────────────────────
  🔍 explore: 探索项目结构
    ⎿ 项目是 Node.js + TypeScript
  ⚒️ build: 实现 JWT 认证
    ⎿ 已实现 14 个源文件
  🛡️ check: 验收
    ⎿ 14/14 PASS
──────────────────────
  再输 /dteam 关闭面板
```

## 内部 API

> 这些不是公开 API，但代码里能看到，供扩展用。

### `src/orchestrator.ts`

```typescript
// 跑一个 goal
export async function run(goal: string, ctx: any): Promise<RunResult>
```

### `src/planner.ts`

```typescript
// 制定执行计划
export async function plan(goal: string, ctx: any): Promise<ExecutionPlan>
```

### `src/leaf.ts`

```typescript
// 用指定角色跑一个 task
export async function execute(role: RoleName, task: string, ctx: any, goal: string): Promise<string>
```

### `src/session.ts`

```typescript
// 创建 worker session（统一入口）
export async function createWorkerSession(options: CreateSessionOptions): Promise<AgentSession>

// 智能选择可用模型
export function pickAvailableModel(ctx: any, primary: string, fallback: string): string

// 获取角色工具列表
export function getRoleTools(role: RoleName): string[]
```

## 配置

### `package.json` Pi 字段

```json
{
  "pi": {
    "name": "dteam",
    "extensions": ["./index.ts"]
  }
}
```

### 模型选择

dteam 优先用 `minimax-cn/MiniMax-M3`，找不到时自动降级到 `minimax-cn/MiniMax-M2.7`。

修改 `src/leaf.ts` / `src/planner.ts` 中对 `pickAvailableModel` 的调用，或直接调整 `src/session/model-resolver.ts`，即可自定义模型选择逻辑。

### 角色配置

在 `src/session.ts` 的 `ROLE_DEFAULTS` 表修改：
- 工具列表
- thinking level
- 描述

或在 `agents/*.md` 修改 systemPrompt（需 frontmatter 格式）。
