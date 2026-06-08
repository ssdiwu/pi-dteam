# dteam v1 执行模式设计：solo / chain / team

> 讨论稿，507 拍板。

## v0 的三种模式

### solo — 单兵突击

```
goal → 派 1 个角色（如 build）→ 完成
```

适用：目标明确、一步就能完成的事。
例：`写一个 hello world 文件`

### chain — 流水线

```
goal → explore → design → build → check → close
            ↓        ↓       ↓       ↓
         探索报告  方案文档  代码实现  验收结果
```

**关键机制**：每一步的输出自动注入下一步的上下文（`withPreviousOutput`）。

适用：复杂目标，需要先探索、再设计、再实现、再验收。
例：`给项目加 JWT 认证`

### team — 并行作战

```
goal → 同时派 N 个 build
       ├─ build-1: 改文件 A
       ├─ build-2: 改文件 B
       └─ build-3: 改文件 C
```

适用：大目标可以拆成独立子任务并行执行。
例：`给 5 个模块各加单元测试`

## v1 现状

v1 只有"万能 brancher 递归分解"：

```
goal → brancher 决定拆不拆 → leaf 执行
```

没有：
- ❌ 角色调度（explore/design/check/close 没人派）
- ❌ 串行流水线（前一步输出不传给下一步）
- ❌ 并行执行（team 模式）

## 设计方案：把 solo/chain/team 嵌入 orchestrator

### 方案：三阶段 orchestrator

把 orchestrator.ts 从"万能 while 循环"改成"先选模式，再按模式执行"：

```
orchestrator.run(goal, ctx)
  │
  ├─ 1. plan(goal) → 判断执行模式 + 角色列表
  │     返回 ExecutionPlan { mode, steps }
  │
  ├─ 2. execute(plan)
  │     ├─ solo  → runSolo(role, task)
  │     ├─ chain → for step in steps: runSolo(role, task, prevOutput)
  │     └─ team  → Promise.all(steps.map(s => runSolo(s.role, s.task)))
  │
  └─ 3. 返回 RunResult
```

### 具体改法

#### orchestrator.ts 改造

```typescript
// 新增：ExecutionPlan 类型
type ExecMode = "solo" | "chain" | "team"

interface ExecStep {
  role: RoleName      // explore / design / build / check / close
  task: string        // 具体任务描述
}

interface ExecutionPlan {
  mode: ExecMode
  steps: ExecStep[]
}

// 新增：plan 阶段（用 LLM 或规则判断模式）
async function plan(goal, ctx): ExecutionPlan {
  // 规则判断（不用 LLM，零成本）：
  // - goal 包含 "同时/并行/分别" → team
  // - goal 很短 < 50 字 → solo（直接 build）
  // - 其他 → chain（默认 5 角色链）

  // 或者：让 brancher 的 decide 工具多返回一个 mode 字段
}

// 改造：主循环
async function run(goal, ctx): RunResult {
  const plan = await plan(goal, ctx)

  if (plan.mode === "solo") {
    return runSolo(plan.steps[0], ctx, goal)
  }

  if (plan.mode === "chain") {
    return runChain(plan.steps, ctx, goal)
  }

  // team
  return runTeam(plan.steps, ctx, goal)
}
```

#### runSolo — 单角色执行

```typescript
async function runSolo(step, ctx, goal): RunResult {
  const session = createWorkerSession({ role: step.role, ... })
  await session.prompt(step.task)
  // 从 session.messages 取结果
}
```

#### runChain — 串行流水线（核心）

```typescript
async function runChain(steps, ctx, goal): RunResult {
  let prevOutput = ""

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const taskWithPrev = prevOutput
      ? `${step.task}\n\n## 上一步输出\n${prevOutput}`
      : step.task

    uiStore.addWorker({ id: stepId, role: step.role, title: step.task })

    const result = await runSolo({ ...step, task: taskWithPrev }, ctx, goal)

    if (result.status === "failed") {
      // chain 中任何一步失败 → 整体失败
      return result
    }

    prevOutput = result.output
    uiStore.updateWorker(stepId, { status: "done", recentOutput: prevOutput })
  }

  return { status: "done", ... }
}
```

#### runTeam — 并行执行

```typescript
async function runTeam(steps, ctx, goal): RunResult {
  const results = await Promise.all(
    steps.map(step => runSolo(step, ctx, goal))
  )
  // 汇总
}
```

### 模式判断规则

不调 LLM，纯规则（零成本）：

| 条件 | 模式 | 角色 |
|------|------|------|
| goal 长度 < 50 字 | solo | build |
| goal 含 "同时/并行/分别/各" | team | N 个 build |
| goal 含 "探索/调研/了解" | solo | explore |
| 其他 | chain | explore → build（简化版） |

或者更激进：

| 条件 | 模式 | 角色链 |
|------|------|--------|
| 简单目标 | solo | build |
| 中等目标 | chain | explore → build |
| 复杂目标 | chain | explore → design → build → check |

### 保留递归分解

brancher 的递归分解能力不丢——它在 chain 的 build 步骤里继续工作：

```
chain: explore → design → build → check
                              ↓
                         brancher.decide()
                         ├─ execute → leaf
                         └─ decompose → 子任务 → brancher → leaf
```

## 和 v0 的区别

| v0 | v1 |
|----|-----|
| WorkerConfig 递归嵌套（chain 里可以嵌套 team） | 简化：mode 顶层确定，不嵌套 |
| 共享内存 + 信号总线传递上下文 | prevOutput 字符串传递（更简单） |
| contextBuilder 构建复杂上下文 | 直接拼 task 字符串 |
| P0/P1/P2/P3 四层架构 | orchestrator 一个文件搞定 |

## 文件改动

| 文件 | 改动 |
|------|------|
| `orchestrator.ts` | 加 plan() + runSolo/runChain/runTeam，保留 brancher 递归 |
| `session.ts` | 已有角色支持，不需要改 |
| `leaf.ts` | 改成通用的 runSolo（按角色创建 session） |
| `brancher.ts` | 不变（在 build 步骤内继续工作） |
| `pool.ts` | 不变（brancher 递归时用） |

## 开放问题

1. **模式判断用规则还是 LLM？** 我建议规则（零成本），复杂情况 fallback 到 chain
2. **chain 角色链固定还是动态？** 我建议：简单→build，中等→explore+build，复杂→全链
3. **team 并发度怎么控制？** v1 先 Promise.all 全并发，v2 再加自适应
4. **chain 中 check 发现问题怎么办？** v1 先不循环修复，v2 再加 "check 失败 → 回到 build"
