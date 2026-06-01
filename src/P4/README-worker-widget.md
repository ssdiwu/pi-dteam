### Worker Status Widget（worker-widget.ts）

在 TUI 中显示 worker 实时状态的 bordered box widget，借鉴 pi-tldr 的设计。

**显示信息**：agent / task / tools / currentTool / elapsed

**使用方式**：

```ts
import { showWorkerStatus, clearWorkerStatus } from "./worker-widget.js";

// 显示
showWorkerStatus(ctx, {
  status: "running",
  agent: "build",
  task: "实现功能",
  toolCount: 3,
  currentTool: "edit",
  elapsedMs: 5000,
});

// 清除
clearWorkerStatus(ctx);
```

**渲染效果**：

```
╭ worker ── 🔄 running ──────────────────────────────────╮
│ Agent: build                                            │
│ Task: 实现功能                                          │
│ Tools: 3 (current: edit)                                │
│ Elapsed: 5.0s                                           │
╰─────────────────────────────────────────────────────────╯
```

**节流**：1s 间隔，避免频繁更新导致 flicker。

**集成位置**：
- `P4/index.ts` wrapWorker：worker_start 时 show，done/failed 时 clear
- `P1/spawn.ts`：`onToolEvent` 回调可用于后续扩展 tool 进度显示
