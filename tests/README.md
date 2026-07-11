# tests/

测试通过公共 `dteam_dispatch` 和 `dispatch()` 行为验证 0.7 模型分级路由；不保留 Orchestrator Loop、Signal Store、五角色或旧 UI 测试。

## 运行

```bash
npm test                # pretest 先 build（src）再 typecheck:test（含 tests），最后跑 vitest
npm run typecheck:test  # 仅对 index.ts + src + tests 做 noEmit 类型检查（tsconfig.test.json）
npm run test:watch
```

`tsconfig.json` 只编译 `src/`（生产构建），`tsconfig.test.json` 把 `tests/` 与根 `index.ts` 一并纳入类型检查，作为 `npm test` 的常驻门禁。

## 测试组织

| 关注点 | 文件 |
|---|---|
| 档位契约与显式模型配置 | `dispatch-contract.test.ts` |
| fresh session 工厂 | `session.test.ts` |
| 执行、权限、provider/T1 回退、timeout、取消、并发 | `dispatch-execute.test.ts` |
| 自适应并发与模型路由 | `phase3-concurrency-routing.test.ts` |
| 唯一 Pi 工具入口、参数校验、结果/错误透传 | `index-dispatch.test.ts` |

## 已知限制

自动化测试 mock（模拟）Pi session/model provider；真实端到端已用 `pi -ne -e ./index.ts --no-session --model minimax-cn/MiniMax-M2.7 --tools dteam_dispatch` 完成一次 T3 派发验证（返回 `done`、`OK`、未回退），其他 provider/模型仍需手验。
