# leaf/

worker（工作者）执行的叶子层——把一个任务交给进程内 `AgentSession` 跑完并取回输出。

## 文件

| 文件 | 职责 |
|---|---|
| `extract.ts` | 从 worker session 的 messages 提取最终 assistant 文本输出 |
| `supplement.ts` | `help` 信号触发时的补充信息处理（等待根注入补充信息后继续执行） |
| `worker-id.ts` | worker 标识生成（`nextWorkerId(role)`） |

## 关系

被 `orchestrator-loop.ts` 的 `summon()` / `runCheck()` 调用；和 `session/` 协作创建 worker session（`createWorkerSession`）。

## 0.6.0 防护

- **maxToolRounds**（`config.ts`，默认 8）：单次 `session.prompt` 内工具调用超限时调 `session.abort()` 中断 worker，防慢模型陷入无限工具调用循环。中断后输出带 `[worker 因工具调用上限被中断]` 标记，Orchestrator 据此感知（见 `SummonStep.interrupted`）。
- `execute()` 第 6 参 `extraCustomTools`：透传给 `createWorkerSession.customTools`，供 `runCheck` 注入 `check_conclude` tool。

详见 ADR 0005（召唤池重定义）。