# dteam 架构说明

> 二维编排模型 + 三阶段流水线。

## 1. 总体架构

```
dteam run(goal, ctx)
  │
  ├─ Phase 1: Plan      planner.ts → ExecutionPlan { mode, steps }
  │                          规则判断（零 LLM 成本） → LLM 兜底
  │
  ├─ Phase 2: Execute   orchestrator.ts 按 mode 分发
  │     ├─ solo  → runSolo(1 step)
  │     ├─ chain → 串行，前一步输出注入下一步
  │     └─ team  → 分批并行（每批 ≤ 3）
  │
  │     每个 step 按 strategy 执行：
  │     ├─ direct      → 调 LLM 一次
  │     ├─ build_check → build→check→修→再 check（最多 3 轮）
  │     └─ adaptive    → 执行→评估→调→再评估（最多 5 轮）
  │
  └─ Phase 3: Report    汇总 stepResults → RunResult
```

## 2. 二维编排模型

两个**完全独立**的维度，任意组合（9 种）：

### 维度一：组织形式（节点怎么组织）

| 形式 | 节点类型 | 含义 |
|------|---------|------|
| `solo` | 叶子 | 单步执行，1 个 step |
| `chain` | 分支 | 串行，前一步输出注入下一步 |
| `team` | 分支 | 并行，分批（每批 ≤ 3 个） |

### 维度二：执行策略（每个 step 怎么跑）

| 策略 | 含义 | 循环 |
|------|------|------|
| `direct` | 跑一次出结果 | 无循环 |
| `build_check` | build → check → 修 → 再 check | 最多 3 轮 |
| `adaptive` | 执行 → 评估 → 调 → 再评估 | 最多 5 轮 |

### 9 种组合

```
组织形式 × 执行策略 = 具体编排

solo + direct        → 读文件、跑命令
solo + build_check   → 单一文件 build→check
solo + adaptive      → 改→看效果→再改
chain + direct       → 串行多步，每步跑一次
chain + build_check  → explore→build(build_check)→check
chain + adaptive     → 探索→迭代优化
team + direct        → 多 explore 并行
team + build_check   → 多 build 并行写代码
team + adaptive      → 多方向并行探索
```

## 3. Phase 1: Plan 阶段

`src/planner.ts`：

```
plan(goal, ctx) → ExecutionPlan
  │
  ├─ 1. 规则判断 quickRuleBasedPlan(goal)
  │     ├─ 空 goal → solo+build+direct
  │     ├─ 长度 < 25 → solo+build+direct
  │     ├─ 并行+编码 → team+build+build_check
  │     ├─ 编码 → chain: explore→build
  │     ├─ 探索 → solo+explore+direct
  │     ├─ 验证 → solo+check+direct
  │     └─ 其他 → null（走 LLM）
  │
  └─ 2. LLM 兜底（调 MiniMax-M3 拿 JSON）
        + normalize* 归一化
        + 失败 fallback solo+build+direct
```

## 4. Phase 2: Execute 阶段

`src/orchestrator.ts`：

```typescript
async function run(goal, ctx): Promise<RunResult> {
  const plan = await planPhase(goal, ctx)

  const results: StepResult[] = []
  switch (plan.mode) {
    case "solo":
      await runStep(plan.steps[0], ctx, results)
      break
    case "chain":
      // 串行 + prevOutput 注入
      let prev = ""
      for (const step of plan.steps) {
        const task = prev ? `${step.task}\n\n## 上一步输出\n${prev}` : step.task
        await runStep({ ...step, task }, ctx, results)
        prev = results[results.length - 1].output
      }
      break
    case "team":
      // 分批并行
      for (let i = 0; i < plan.steps.length; i += 3) {
        const batch = plan.steps.slice(i, i + 3)
        await Promise.all(batch.map(s => runStep(s, ctx, results)))
      }
  }

  return { status, plan, steps: results, summary }
}
```

每个 step 按 strategy 分发：

```typescript
async function runStep(step, ctx, results) {
  switch (step.strategy) {
    case "direct":      return runDirect(step, ctx)
    case "build_check": return runBuildCheck(step, ctx)  // build→check 循环
    case "adaptive":    return runAdaptive(step, ctx)    // 执行→评估循环
  }
}
```

## 5. 关键约束

| 约束 | 说明 |
|------|------|
| `team` 并发度 | 每批 ≤ 3，避免撞 API 限流 |
| `build_check` 轮数 | 最多 3 轮 |
| `adaptive` 轮数 | 最多 5 轮 |
| chain 中 step 失败 | 整个 chain 终止，保留已完成结果 |
| 角色权限 | build 唯一能改代码（edit/write 工具） |

## 6. 数据流

```
goal (string)
  ↓
plan (LLM/规则)
  ↓
ExecutionPlan { mode, steps: [{ role, task, strategy }] }
  ↓
每 step:
  createWorkerSession({ role }) → session.prompt(task) → text output
  ↓
StepResult { role, task, strategy, status, output, rounds? }
  ↓
RunResult { status, goal, plan, steps, summary }
```

## 7. 失败处理

| 失败点 | 行为 |
|--------|------|
| planner LLM 调用失败 | fallback `solo + build + direct` |
| build_check 3 轮不过 | 返回最后结果，标记 done |
| adaptive 5 轮不收敛 | 返回最后结果，标记 done |
| chain 中 step 抛错 | 标记 failed，chain 终止 |
| team 中 step 抛错 | 标记 failed，其他 step 继续 |
| session.prompt 抛错 | 整个 step 标记 failed |
