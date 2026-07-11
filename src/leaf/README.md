# leaf/

`leaf.ts` 是 0.7 `dispatch(request, ctx)` 的执行入口；本目录只保留其消息提取辅助文件。

| 文件 | 职责 |
|---|---|
| `extract.ts` | 从 fresh worker session 的 messages 提取最后的 assistant 文本 |

`dispatch()` 本身位于父目录，负责档位模型尝试、timeout、cancellation、并发槽释放与 T1 回退。0.6 的 role `execute()`、help 补充与 worker ID 已删除。
