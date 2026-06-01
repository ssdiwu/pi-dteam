### Worker Status Widget（worker-widget.ts）

在 TUI 中显示 worker 实时状态，支持**折叠态**和**展开态**两种模式。

#### 折叠态（默认）

bordered box 显示基础信息，借鉴 pi-tldr 的设计。

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

#### 展开态（Ctrl+O 切换）

全屏覆盖层显示 AgentProgress 详细信息。按 **Ctrl+O** 在折叠/展开之间切换。

**字段映射**：

| 字段 | 来源 | 说明 |
|------|------|------|
| `currentTool` | AgentProgress | 当前正在执行的工具名 |
| `recentOutput` | AgentProgress | 最近输出（最多 8 行） |
| `tokenCount` | AgentProgress | Token 消耗量 |
| `duration` | `Date.now() - startTime` | 执行总时长 |
| `activityFreshness` | `Date.now()` | 最近活动时间 |
| `currentToolDuration` | 工具开始时间差 | 当前工具执行时长 |

**渲染效果**：

```
🔄 Worker: build │ running │ 2m 30s
─────────────────────────────────────────
Task: 实现功能

Current Tool: bash (15s)
─────────────────────────────────────────
Recent Output (5 tools):
  > $ npm test
  > ✓ 138 tests passed
─────────────────────────────────────────
Token Count: 12,345
Activity: 5s ago

[Ctrl+O] collapse
```

**使用方式**：

```ts
import {
  showWorkerStatus,
  clearWorkerStatus,
  updateAgentProgress,
  toggleWorkerExpanded,
} from "./worker-widget.js";

// 注册 Ctrl+O 快捷键（在 P4/index.ts session_start 中）
pi.registerShortcut("ctrl+o", {
  description: "Toggle worker progress fullscreen",
  handler: (ctx) => toggleWorkerExpanded(ctx),
});

// 更新进度数据（在 spawnAgent 的 onToolEvent/onUpdate 回调中）
updateAgentProgress(progress);
```

#### 节流

折叠态：1s 间隔，避免频繁更新导致 flicker。
展开态：500ms 间隔，通过 `setInterval` + `tui.requestRender()` 定期刷新。

#### 集成位置

- `P4/index.ts` wrapWorker：worker_start 时注入 `onProgress` 回调，show/done/failed 时 clear
- `P1/spawn.ts`：`onUpdate` / `onToolEvent` 回调 → `context.onProgress` → `updateAgentProgress`
- `P2/worker.ts`：默认 executor 中 `spawnAgent` 接入 `onUpdate`/`onToolEvent`
