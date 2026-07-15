# types/

| 文件 | 内容 |
|---|---|
| `dispatch.ts` | 0.7 `leaf.ts` 同步 dispatch 的类型契约：`Tier`、`ThinkingLevel`、`DispatchRequest`、`DispatchResult`、模型路由与尝试记录 |

0.8 的公开 `dteam` 工具、worker 生命周期、signal 与 parent event 类型位于 [`../runtime/types.ts`](../runtime/types.ts)，不在本目录复制。这里不保留 loop、role 或旧 run/UI 状态类型。
