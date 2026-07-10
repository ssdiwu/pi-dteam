# tests/

dteam 0.6.0→0.7.0 过渡期的行为测试。用 vitest 验证旧 loop 兼容基线，以及 T1/T2/T3 fresh dispatch、路由、回退和工具边界。

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
| 0.7 档位派发契约 | `dispatch-contract.test.ts`（T3 只读、显式 tools 上限、thinking、档位模型链） |
| 0.7 fresh dispatch 执行 | `dispatch-execute.test.ts`（隔离 session、T1 只读验收、provider fallback、超时/T3→T1 硬回退、共享并发与 429 降并发） |
| 角色会话（0.6 兼容） | `session.test.ts`、`leaf.test.ts` |
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
