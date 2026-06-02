### Worker 状态 Widget（worker-widget.ts）

TUI 中显示 worker 实时状态，支持**折叠态**和**展开态**两种模式。

#### 折叠态（默认，多 worker 单行）

worker 运行时在 TUI 中显示多 worker 单行 + 嵌套缩进 + 信号角标。1s 跳秒实时刷新（不再卡死）。

**单行格式**：

```
● build  实现功能  T:3 · edit  5.0s  📡
  ↳ step1/3 探索  2.1s  ✓
● check  验收  T:1  1.2s
```

**字段说明**：
- `●/✓/✗/⏳`：状态图标（running/done/failed/pending）
- `role`：执行角色（explore/design/build/check/...）
- `task`：任务描述
- `T:N`：已用工具数
- `· edit`：当前正在执行的工具
- `5.0s`：耗时
- `📡/🚧/🔍/🆘`：信号类型角标（progress/blocked/found/help）
- `×3`：信号累计次数
- `↳`：嵌套缩进（team/chain 的子 worker 缩进 2 空格）

**信号类型 → emoji 映射**：
| 信号 | 图标 | 含义 |
|------|------|------|
| `progress` | 📡 | 进度更新 |
| `blocked` | 🚧 | 阻塞 |
| `found` | 🔍 | 发现 |
| `help` | 🆘 | 求助 |

#### 状态栏（极简计数）

底部状态栏显示 `N workers · M running` 极简计数。worker 增/删/状态变化时实时更新。

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
● build │ running │ 2m 30s │ 📡×2
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

#### 数据流（onProgress 链路）

```
wrapWorker (P4/index.ts:86)
  └─ 注入闭包: onProgress: (p) => updateAgentProgress(workerId, p)
       └─ workerStart (P2/worker.ts)
            └─ executeInBackground 注入 context.onProgress
                 └─ default executor (P2/worker.ts:198)
                      └─ spawnAgent({ onUpdate, onToolEvent })
                           └─ 流式回调 → context.onProgress
                                └─ updateAgentProgress(workerId, p)
                                     ├─ store.set(workerId, ...)
                                     └─ activeTui?.requestRender() ← 1s 跳秒
```

**关键修复**：workerId 通过闭包绑定到 onProgress，避免主 workerId 与子 workerId 互不相通的问题。

#### 终态清理（关键修复）

`background` worker 完成后，3s 内从 widget 消失（让用户能看终态行再消失）：

1. P2/worker.ts `executeInBackground` finally 块调 `onComplete?.(status, error)`
2. P4 wrapWorker 注入 `onComplete: (status, error) => registerWorkerTerminated(workerId, status, error)`
3. `registerWorkerTerminated` 标记 store 中该 worker 为终态 + 调度 `scheduleTerminationCleanup(workerId)` 3s 后 `store.delete(workerId)`

#### 嵌套关系（team/chain）

- `team` 模式：每个子 worker 通过 `bus.emit('progress', `${teamId}-${i}`, { parentWorkerId: teamId, role, task })` 注册到 store
- `chain` 模式：每个 step 通过 `bus.emit('progress', `${chainId}-${i+1}`, { parentWorkerId: chainId, chainIndex: i+1, chainTotal: N, isChainStep: true })` 注册
- P4 `installSignalBridge` 订阅 4 个信号类型（progress/blocked/found/help），自动写入 store

#### 信号桥接（store ← bus）

P4 在 `extension` 启动时调 `installSignalBridge(workerBus)`：
- 订阅 4 种信号（progress/blocked/found/help）
- 收到信号时：
  1. `applySignalToStore`：从 signal data 提取 `parentWorkerId`/`role`/`chainIndex` 等写入 store
  2. `recordSignal`：更新 `lastSignal` + `signalCount`
  3. `activeTui?.requestRender()`：触发 TUI 重绘

#### 使用方式

```ts
import {
  showWorkerStatus,
  clearWorkerStatus,
  updateAgentProgress,
  registerWorkerTerminated,
  toggleWorkerExpanded,
  installSignalBridge,
} from "./worker-widget.js";

// 注册 Ctrl+O 快捷键
pi.registerShortcut("ctrl+o", {
  description: "Toggle worker progress fullscreen",
  handler: (ctx) => toggleWorkerExpanded(ctx),
});

// 更新进度数据（推荐用 wrapWorker 自动注入的闭包）
updateAgentProgress(workerId, progress);

// 终态清理
registerWorkerTerminated(workerId, "done");
registerWorkerTerminated(workerId, "failed", errorMsg);

// 安装信号桥接
installSignalBridge(bus);
```

#### 节流与刷新

- 折叠态：1s 跳秒（`setInterval` 在 widget factory 启动）
- 展开态：500ms 间隔（`setInterval` + `tui.requestRender()`）
- 节流：1s 内多次 `showWorkerStatus` 只更新 1 次（避免 flicker）

#### 内存管理

- widget factory 抓 `tui` + 启动 tick interval
- `dispose()` 清 interval + 清 activeTui 引用
- `invalidate()` 清 cachedLines（theme 切换时重绘）
- `clearAllWorkerWidgets()` 用于 session shutdown
