# P3 — 组织层

> 依赖 P0 + P1 + P2，提供顶层编排入口。

## 模块清单

| 文件 | 职责 |
|------|------|
| `worker.ts` | Worker 编排器：根据 config.type 分发到 solo/chain/team |
| `chainPlanner.ts` | Task → ChainPlan 解析器：从 task Markdown 自动生成执行计划；只把 A 层可校验项纳入 plan |
| `workItemPlanner.ts` | **workItem 规划器**：把 A 层 AC materialize 成 `workItems[]`；提供 `materializeTaskToWorkItems` / `refreshWorkItemReadiness` / `claimNextWorkItem` / `projectChecklistStatus`；B 层人工裁决项不进 workItems[] |

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
    └─ extractAcceptanceModel() → 解析双层验收；A 层项 → 角色匹配

materializeTaskToWorkItems({ taskPath, acceptance })
  → WorkItem[]
refreshWorkItemReadiness(items) → items（todo → ready）
claimNextWorkItem(items) → WorkItem | null
projectChecklistStatus(items) → ChecklistStatus[]
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

interface WorkItem {
  id: string;                // 初始项 = "AC-N"
  source: WorkItemSource;    // acceptance / derived
  title: string;
  acceptance: string[];
  status: WorkItemStatus;    // todo / ready / in_progress / waiting_help / blocked / done / skipped
  dependsOn: string[];
  attempts: AttemptRecord[];
  helpers: HelperRecord[];
  // ... 详见 src/P0/workItem.ts
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

## 双层验收边界（v1 硬规则）

- `chainPlanner.generatePlan()` **只**用 A 层 AC 文本驱动 step 描述
- `workItemPlanner.materializeTaskToWorkItems()` **只**消费 A 层 → `workItems[]`
- B 层人工裁决项 **不**进 plan、**不**进 workItems[]；保留在 task.md，交给最终 review
