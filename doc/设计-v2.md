# dteam v1 二维编排设计（对齐稿）

> 和 507 对齐后的设计。改动前先对齐，对齐后再动手。

## 一、整体架构

```
dteam run(goal)
  │
  ├─ Phase 1: Plan（规划阶段）
  │     问 LLM：这个 goal 怎么拆？用什么模式？什么策略？
  │     输出：ExecutionPlan
  │
  ├─ Phase 2: Execute（执行阶段）
  │     按 ExecutionPlan 派 worker
  │     递归分解在 build 步骤内部自然发生
  │
  └─ Phase 3: Report（汇报阶段）
        汇总结果，返回给用户
```

## 二、二维编排模型

两个独立维度：

### 维度一：组织形式

| 形式 | 节点类型 | 含义 |
|------|---------|------|
| solo | 叶子 | 1 个角色干 1 件事 |
| chain | 分支 | N 个角色串行，前一步输出注入下一步 |
| team | 分支 | N 个角色并行，并发度 ≤ 3 |

约束：
- **solo = 叶子节点**（最小执行单元）
- **chain/team = 分支节点**（只协调，不直接干活）
- **team 并发上限 = 3**（避免撞并发限制）

### 维度二：执行策略

| 策略 | 含义 | 循环 |
|------|------|------|
| ① 直接完成 | 跑一次出结果 | 无循环 |
| ② 建检循环 | build → check → 不通过就修 → 再 check → 通过 | build+check 循环 |
| ③ 自适应 | 执行 → 对照 goal 评估 → 不满意就调 → 再评估 | 开放迭代 |

### 组合关系

```
组织形式 × 执行策略 = 具体编排

solo + ① 直接完成     → 读文件、跑命令、简单查询
solo + ② 建检循环     → 写代码→验证→修→再验（单一文件）
solo + ③ 自适应       → 改→看效果→不满意再改→OK

chain + ① 直接完成    → explore → design（串行，各跑一次）
chain + ② 建检循环    → build → check → 修 → 再 check（串行验证）
chain + ③ 自适应      → 逐步迭代优化

team + ① 直接完成     → 多个 explore 并行探路
team + ② 建检循环     → 多个 build 并行写 + 各自 check
team + ③ 自适应       → 多个方向同时探索最优解
```

## 三、Phase 1: Plan（规划阶段）

### 3.1 入口

```typescript
async function plan(goal: string, ctx: any): Promise<ExecutionPlan>
```

### 3.2 用 LLM 做 plan

用 brancher 同款 tool calling 方式，让 LLM 返回结构化的 ExecutionPlan：

```typescript
// ExecutionPlan 结构
interface ExecutionPlan {
  /** 组织形式 */
  mode: "solo" | "chain" | "team"
  /** 执行策略 */
  strategy: "direct" | "build_check" | "adaptive"
  /** 步骤列表 */
  steps: PlanStep[]
  /** plan 理由 */
  reason: string
}

interface PlanStep {
  /** 角色 */
  role: "explore" | "design" | "build" | "check" | "close"
  /** 具体任务描述 */
  task: string
  /** 预计涉及的文件（可选） */
  files?: string[]
}
```

### 3.3 plan 工具定义

```typescript
{
  name: "plan",
  label: "plan",
  description: "为这个 goal 制定执行计划",
  parameters: Type.Object({
    mode: Type.Union([Type.Literal("solo"), Type.Literal("chain"), Type.Literal("team")]),
    strategy: Type.Union([Type.Literal("direct"), Type.Literal("build_check"), Type.Literal("adaptive")]),
    reason: Type.String({ description: "为什么选这个模式和策略" }),
    steps: Type.Array(Type.Object({
      role: Type.Union([
        Type.Literal("explore"),
        Type.Literal("design"),
        Type.Literal("build"),
        Type.Literal("check"),
        Type.Literal("close"),
      ]),
      task: Type.String({ description: "具体任务描述" }),
      files: Type.Optional(Type.Array(Type.String())),
    })),
  }),
}
```

### 3.4 plan 的 system prompt

```
你是 dteam 的规划器。根据用户目标，制定执行计划。

规则：
- 简单目标（一步能完成）→ solo + direct
- 中等目标（需要探索再干）→ chain + direct
- 编码目标（需要写代码）→ chain + build_check
- 模糊目标（需要迭代）→ chain + adaptive
- 可拆分的独立子任务 → team + 对应策略

chain 默认角色链：explore → design → build → check → close
- 可以截断：简单编码 → build → check
- 可以扩展：探索任务 → explore

team 的每个 step 是独立的，它们会并行执行。
team 并发上限 3，不要生成超过 5 个 step。
```

### 3.5 plan 示例

**简单目标**："写一个 hello world 文件"
```json
{
  "mode": "solo",
  "strategy": "direct",
  "reason": "一步就能完成，直接写文件",
  "steps": [
    { "role": "build", "task": "创建 hello.txt，内容为 Hello World" }
  ]
}
```

**编码目标**："给项目加 JWT 认证"
```json
{
  "mode": "chain",
  "strategy": "build_check",
  "reason": "需要先探索再实现再验证",
  "steps": [
    { "role": "explore", "task": "探索项目结构，了解认证现状" },
    { "role": "build", "task": "实现 JWT 认证中间件和相关 API" },
    { "role": "check", "task": "验证认证功能正常，tsc 无报错" }
  ]
}
```

**并行目标**："给 5 个模块各加单元测试"
```json
{
  "mode": "team",
  "strategy": "build_check",
  "reason": "5 个模块独立，可以并行写测试",
  "steps": [
    { "role": "build", "task": "为 auth 模块写单元测试", "files": ["src/auth/"] },
    { "role": "build", "task": "为 user 模块写单元测试", "files": ["src/user/"] },
    { "role": "build", "task": "为 order 模块写单元测试", "files": ["src/order/"] },
    { "role": "check", "task": "跑全量测试，确认全部通过" }
  ]
}
```

## 四、Phase 2: Execute（执行阶段）

### 4.1 三种组织形式的执行

#### solo：单步执行

```
runSolo(step)
  → createWorkerSession({ role: step.role })
  → session.prompt(step.task)
  → 取结果
```

#### chain：串行执行，前一步输出注入下一步

```
runChain(steps)
  prevOutput = ""
  for step in steps:
    task = step.task + (prevOutput ? "\n## 上一步输出\n" + prevOutput : "")
    result = runSolo({ ...step, task })
    if result.failed → 整个 chain 失败
    prevOutput = result.output
```

**这是 v0 `withPreviousOutput` 的 v1 简化版**：
- 不改 WorkerConfig，直接拼 task 字符串
- 零额外基础设施

#### team：并行执行，并发度 ≤ 3

```
runTeam(steps)
  // 分批，每批最多 3 个
  batches = chunk(steps, 3)
  for batch in batches:
    results = await Promise.all(batch.map(s => runSolo(s)))
    if any failed → 记录失败，继续下一批
```

**为什么是 3 不是全并发？**
- 避免撞 API 并发限制（429）
- LLM API 通常并发限制在 5~10，dteam 占 3 留余量给主对话
- 3 个 worker 已足够利用并行度

### 4.2 三种执行策略的实现

#### ① 直接完成

```
runSolo(step)
  → 结果
```

就是 solo 本身，跑一次出结果。

#### ② 建检循环

```
runBuildCheck(step)
  loop (max 3 轮):
    result = runSolo({ role: "build", task: step.task })
    checkResult = runSolo({ role: "check", task: "验证：" + step.task + "\n## build 输出\n" + result })

    if checkResult.passed → return result
    if checkResult.issues:
      step.task = "修复以下问题：" + checkResult.issues + "\n原任务：" + step.task

  return result  // 3 轮还没过就返回最后的结果
```

**关键**：build → check → 不通过就把问题注入 task → 再 build → 再 check。最多 3 轮。

#### ③ 自适应

```
runAdaptive(step)
  loop (max 5 轮):
    result = runSolo({ role: "build", task: step.task })
    evalResult = runSolo({ role: "check", task: "评估距离目标的差距：" + step.task + "\n## 当前输出\n" + result })

    if evalResult.satisfied → return result
    step.task = evalResult.feedback + "\n原任务：" + step.task

  return result
```

和 ② 的区别：
- ② 是硬验收（PASS/FAIL）
- ③ 是软评估（满意/不满意 + 改进建议）

### 4.3 递归分解在哪？

**在 build 步骤内部自然发生。**

brancher 的 `decide()` 保留。当 plan 的某个 step 是 build 角色时：

```
plan step: build → "实现 JWT 认证"
  │
  ├─ brancher.decide("实现 JWT 认证")
  │   → decompose: ["实现中间件", "实现 login API", "实现 register API"]
  │
  └─ 每个 sub-task → leaf.execute()
       → createWorkerSession({ role: "build" })
       → session.prompt(sub-task)
```

所以递归分解不是被替代，而是**嵌套在 plan 的 build 步骤里**。

### 4.4 完整执行流程

```
orchestrator.run(goal, ctx)
  │
  ├─ 1. plan(goal, ctx) → ExecutionPlan
  │     UI: 显示规划结果
  │
  ├─ 2. execute(plan, ctx)
  │     │
  │     ├─ mode=solo  → runSolo(steps[0])
  │     │                如果 strategy=build_check → 加 check 循环
  │     │                如果 strategy=adaptive → 加评估循环
  │     │
  │     ├─ mode=chain → runChain(steps)
  │     │                前一步输出注入下一步
  │     │                build 步骤内部触发 brancher 递归分解
  │     │
  │     └─ mode=team  → runTeam(steps)
  │                      分批并行（每批 ≤ 3）
  │
  └─ 3. 返回 RunResult
```

## 五、和现有代码的关系

### 不改的

| 文件 | 说明 |
|------|------|
| `pool.ts` | 任务池，brancher 递归分解时继续用 |
| `brancher.ts` | 递归分解，在 build 步骤内部继续工作 |
| `leaf.ts` | 实际执行，被 runSolo 复用 |
| `session.ts` | 角色工厂，已有 role 支持 |
| `ui-*.ts` | UI 层不变 |

### 改的

| 文件 | 改动 |
|------|------|
| `orchestrator.ts` | 加 plan 阶段 + execute 按模式分发 + 三种策略 |
| `tools.ts` | 加 ExecutionPlan / PlanStep / ExecMode / Strategy 类型 |

### 新增的（可选）

| 文件 | 说明 |
|------|------|
| `planner.ts` | plan 阶段的 LLM 调用（类似 brancher.ts） |

## 六、v1 范围

做：
- ✅ plan 阶段（LLM 结构化输出）
- ✅ solo / chain / team 三种组织形式
- ✅ ① 直接完成 + ② 建检循环 + ③ 自适应三种策略
- ✅ chain 的 prevOutput 注入
- ✅ team 分批并行（≤ 3）
- ✅ 递归分解在 build 内部继续工作
- ✅ UI 显示 plan 结果

不做（v2）：
- ❌ plan 确认面板（Phase 1→Phase 2 人工确认）
- ❌ 自适应并发度
- ❌ 信息素
- ❌ 依赖分析 + 文件锁
- ❌ 持久化 + 恢复
