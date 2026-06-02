# P3 — 组织层

> 依赖 P0 + P1 + P2，提供顶层编排入口。

## 模块清单

| 文件 | 职责 |
|------|------|
| `worker.ts` | Worker 编排器：根据 config.type 分发到 solo/chain/team |
| `chainPlanner.ts` | Task → ChainPlan 解析器：从 task Markdown 自动生成执行计划 |

## 依赖关系

```
P3 → P2 → P1 → P0
```

## 调用链

```
runWorker(config, bus, memory, executor)
  ├─ solo  → runSolo()
  ├─ chain → runChain()
  └─ team  → runTeam()

planFromTaskId(cwd, taskId)
  → readFile → generatePlan(content, filename)
    ├─ extractTaskType()  → 选择默认链模板
    ├─ extractGoal()      → 生成 step 描述（目标为空会抛错）
    └─ extractAcceptanceCriteria() → 匹配验收条件到角色
```

## 返回值

```typescript
interface OrchestratorResult {
  status: WorkerStatus;  // "done" | "failed"
  result: WorkerResult;  // SoloResult | ChainResult | TeamResult
  conclusion?: string;
  error?: string;
}

interface ChainPlan {
  taskId: string;
  taskType: string;
  steps: ChainStep[];
}

interface ChainStep {
  role: string;         // explore/design/build/check/close
  mode: "solo";
  task: string;         // 该步骤的任务描述
  dependsOn?: string[];  // 依赖的前序步骤角色
}
```

## 默认链模板

| task 类型 | 角色链 |
|-----------|--------|
| `refactor` | explore → design → build → check → close |
| `bugfix` | explore → build → check → close |
| `infra` | explore → design → build → check → close |
| `functional` | explore → build → check → close |
| `ui` | explore → design → build → check → close |
| 未知 | explore → build → check → close |
