# tests/

测试通过公共 `dteam` 工具、Worker Manager、signal、动态工具策略和 `/dteam` 管理状态验证 0.8 行为。

## 运行

```bash
npm test
npm run typecheck:test
```

## 测试组织

| 文件 | 关注点 |
|---|---|
| `index-dispatch.test.ts` | 唯一 `dteam` 工具、同名 `/dteam` 命令、参数 fail-closed |
| `dynamic-tools.test.ts` | 首次 active set、候选工具、第三方降级 |
| `worker-manager.dispatch.test.ts` | 请求校验、派发、档位候选、共享并发与工具额度 |
| `worker-manager.recovery.test.ts` | timeout recovery、重试、升级、延长和恢复预算边界 |
| `worker-manager.lifecycle.test.ts` | 快照投影、事件与脱敏、取消、shutdown 和创建竞态 |
| `signal-request.test.ts` | A/B/C signal、阻塞 request、原 session 恢复和 requestId 作用域 |
| `tui-dialog.test.ts` | `/dteam` 列表、详情、实时文本/thinking/工具、timeout 诊断、包边、i18n 文案和运行/历史只读状态 |
| `i18n.test.ts` | `pi.i18n.v1` bundle 注册与多通道 API 去重 |
| `cancel.test.ts` | 用户取消二次确认与 `user_cancelled` |
| `dispatch-contract.test.ts` / `dispatch-execute.test.ts` / `phase3-concurrency-routing.test.ts` | 0.7 保留的档位契约、模型路由、自适应并发和底层 dispatch 执行回归 |
| `extract.test.ts` | fresh worker 最后一条 assistant 文本提取 |
| `model-config.test.ts` | `~/.pi/agent/pi-dteam.json` 的三档模型配置校验与候选链解析 |
| `session.test.ts` | fresh `AgentSession` 与 Logical Isolation（逻辑隔离）创建边界 |

真实 provider 与 TUI 体验不由 mock 测试替代，需在目标 Pi 环境另行冒烟。
