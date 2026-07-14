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
| `worker-manager.test.ts` | worker 生命周期、并发、回退、聚合、失败、shutdown |
| `signal-request.test.ts` | A/B/C signal、阻塞 request、原 session 恢复和 requestId 作用域 |
| `tui-dialog.test.ts` | `/dteam` 列表、详情、包边、i18n 文案和运行/历史只读状态 |
| `i18n.test.ts` | `pi.i18n.v1` bundle 注册与多通道 API 去重 |
| `cancel.test.ts` | 用户取消二次确认与 `user_cancelled` |
| `dispatch-*` / `phase3-*` | 0.7 保留的档位、路由和底层执行回归 |

真实 provider 与 TUI 体验不由 mock 测试替代，需在目标 Pi 环境另行冒烟。
