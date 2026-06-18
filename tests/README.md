# tests/

dteam 0.6.0 的行为测试。用 vitest，通过公共接缝验证 Orchestrator Loop、Signal Store、并发/路由、角色边界和 worker 执行。

## 运行

```bash
npm test          # 先 build 再跑 vitest（不含 archive/）
npm run test:watch
```

## 测试组织（0.6.0）

| 关注点 | 代表文件 |
|---|---|
| Orchestrator Loop 主循环 | `orchestrator-loop.test.ts`（summon/check/done 流转、Completion Gate、maxRounds/maxCheckRetries、fail 兜底） |
| Signal Store（TTL 衰减） | `signal-store.test.ts`（emit/getActive/TTL/dispose/maxSignals） |
| Adaptive Concurrency + Multi-Provider Routing | `phase3-concurrency-routing.test.ts`（升降并发、429 冷却、fallback 链） |
| 角色会话 | `session.test.ts`、`leaf.test.ts` |
| 信号通路（leaf 桥接用） | `signal-bus.test.ts`、`runs-store.test.ts` |
| 架构参考 | `reference-data.test.ts` |

## 已删除的 0.5.0 测试

0.6.0 重定义后，以下 0.5.0 测试随旧二维编排代码一并删除：
`orchestrator.test.ts`、`planner.test.ts`、`pool.test.ts`、`chain-forward.test.ts`、
`scheduler-file-graph.test.ts`、`scheduler-preflight.test.ts`、`scenario-help.test.ts`、
`scenario-human.test.ts`、`index-background-run.test.ts`、`signal-integration.test.ts`、
`types.test.ts`（旧二维编排类型）、`ui-store.test.ts`、`ui-panel.test.ts`、`reporter.contract.test.ts`。

## 已知限制

- `orchestrator-loop.test.ts` 和 `phase3-concurrency-routing.test.ts` 用 `vi.mock` 替换 `createWorkerSession` + `leaf.execute`，验证决策流转/并发/路由逻辑，不验证真实 LLM 交互。
- 端到端实测（真实 LLM 跑通 `/dteam <goal>`）需在有 API key 的 Pi 环境中手动验证。
