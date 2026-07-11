# types/

| 文件 | 内容 |
|---|---|
| `dispatch.ts` | 0.7 唯一运行时类型：`Tier`、`ThinkingLevel`、`DispatchRequest`、`DispatchResult`、模型路由与尝试记录 |

不保留 loop、role、signal、run 或 UI 状态类型；dteam 的执行、验收和回退全部由 `DispatchRequest`/`DispatchResult` 表达。
