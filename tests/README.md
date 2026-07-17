# tests/

测试通过四工具公开 API、Worker Manager、统一 WorkerReport、signal/wait、动态工具策略和 `/dteam` 管理状态验证当前行为。

## 运行

```bash
npm test
```

`bun test`（Bun 测试）直接执行 TypeScript（TypeScript 代码）。部分测试使用进程级 `mock.module`（模块 mock），因此脚本固定 `--max-concurrency=1`，避免并行文件互相污染 mock。

## 测试组织

| 文件 | 关注点 |
|---|---|
| `index-dispatch.test.ts` | 四工具、同名 `/dteam` 命令、紧凑渲染与参数 fail-closed |
| `dynamic-tools.test.ts` | 首次 active set、候选工具、第三方降级 |
| `worker-manager.dispatch.test.ts` | 请求校验、派发、档位候选、共享并发与工具额度 |
| `worker-manager.recovery.test.ts` | timeout recovery、重试、升级、延长和恢复预算边界 |
| `worker-manager.lifecycle.test.ts` | 快照投影、事件与脱敏、取消、shutdown 和创建竞态 |
| `signal-request.test.ts` | A/B/C signal、阻塞 request、原 session 恢复和 requestId 作用域 |
| `worker-manager.protocol.test.ts` | Manager 报告回收、handoff provenance、verification 不进入 handoff、writeScope/write_interrupted 与 respond/recover 边界 |
| `worker-manager.report.test.ts` | WorkerReport 枚举、字段与交叉不变量、旧形状 fail-closed 及统一 parser/tool 契约 |
| `worker-report.fixture.ts` | 跨测试复用的最小合法 WorkerReport 工厂；不是测试入口 |
| `test-helpers.ts` / `mock-modules.ts` | Bun 原生 `waitFor`（等待断言）和跨文件模块 mock；不是测试入口 |
| `worker-manager.wait.test.ts` | 指定 worker 的事件等待、事件后置消费、未消费 flush 与 timeout 部分结果 |
| `worker-usage-ledger.test.ts` | 独立 dteam usage 的数字白名单、稳定去重键、JSONL 追加与 `0600` 权限 |
| `tool-result.test.ts` | 默认摘要与 Ctrl+O 人类可读展开，不展示 JSON |
| `tui-dialog.test.ts` | `/dteam` 列表、详情、实时文本/thinking/工具、timeout 诊断、WorkerReport 人类可读投影、包边、i18n 文案和运行/历史只读状态 |
| `i18n.test.ts` | `pi.i18n.v1` bundle 注册与多通道 API 去重 |
| `cancel.test.ts` | 用户取消二次确认与 `user_cancelled` |
| `dispatch-contract.test.ts` / `phase3-concurrency-routing.test.ts` | 0.7 保留的档位契约、模型路由和自适应并发回归 |
| `extract.test.ts` | fresh worker 最后一条 assistant 文本提取 |
| `model-config.test.ts` | `~/.pi/agent/pi-dteam.json` 的三档模型配置校验与候选链解析 |
| `session.test.ts` | fresh `AgentSession` 与 Logical Isolation（逻辑隔离）创建边界 |

真实 provider 与 TUI 体验不由 mock 测试替代，需在目标 Pi 环境另行冒烟。
