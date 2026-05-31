# P3 — 组织层

> 依赖 P0 + P1 + P2，提供顶层编排入口。

## 模块清单

| 文件 | 职责 |
|------|------|
| `worker.ts` | Worker 编排器：根据 config.type 分发到 solo/chain/team |

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
```

## 返回值

```typescript
interface OrchestratorResult {
  status: WorkerStatus;  // "done" | "failed"
  result: WorkerResult;  // SoloResult | ChainResult | TeamResult
  conclusion?: string;
  error?: string;
}
```
