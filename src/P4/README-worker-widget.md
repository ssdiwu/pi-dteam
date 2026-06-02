### Worker 状态 Widget（worker-widget.ts）

TUI 中显示 worker 实时状态，支持**折叠态**（默认）和 **Tab 面板**（/dteam 触发）两种模式。

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

#### Tab 面板（/dteam 命令触发）

基于 `ctx.ui.custom` 的全屏覆盖层，支持**多 worker Tab 切换**和**嵌套关系展开**。

**入口**：输入 `/dteam` 命令（注册于 `P4/index.ts`），由 `showWorkerPanel(ctx)` 触发。再次输入 `/dteam` 关闭（幂等折叠）。

**布局**：

```
 📊 dteam worker progress
 [● w-1] [○ w-2] [✓ team-1]
─────────────────────────────────────────
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
─────────────────────────────────────────
Nested workers (2):
  ↳ [1/3] 探索  T:2 · read  1.2s
  ↳ [2/3] 设计  T:4 · write  3.5s
  Press Enter on a child to view its detail
─────────────────────────────────────────
  [Tab/⇧Tab · ←/→] switch worker · [Enter] view child · [Esc/q/Ctrl+C] close
```

**Tab 栏规则**（`buildTabBar` 纯函数）：
- 每个父 worker 一个 tab（无 `parentWorkerId` 的）
- 当前选中 tab 用 `accent` 强调色 + 实心 ● 图标
- 最多展示 10 个 tab；超出折叠为 `[+N more]`
- 父 worker 为空：显示 `(no workers)`（灰色 muted）

**键盘路由**（`showWorkerPanel.handleInput`）：

| 按键 | 主 tab 模式 | 子 worker 详情模式 |
|------|------------|---------------------|
| `Tab` / `→` | 下一 tab | 返回父 tab |
| `⇧Tab` / `←` | 上一 tab | 返回父 tab |
| `Enter` | 进入子 worker 详情 | — |
| `Esc` / `q` / `Ctrl+C` | 关闭 panel | 先返回父 tab，不关闭 |

**嵌套 worker 区域**（`formatNestedWorkers` 纯函数）：
- 仅在当前 worker 有子 worker（`parentWorkerId === current.workerId`）时显示
- 按 `chainIndex` 排序（兜底 `startTime`）
- 缩进 2 空格 + `↳`，与折叠态单行格式保持一致
- 底部提示：`Press Enter on a child to view its detail`

**`Back to parent` 提示**（`buildTabContent` 的 `showBackToParent` 选项）：
- 进入子 worker 详情后，在 Tab 内容顶部显示 ◀ Back to parent (Esc) 提示
- `Esc`/`Tab`/`←`/`→` 任一键均可返回父 tab

#### 纯函数 API（`buildTabBar` / `buildTabContent` / `formatNestedWorkers`）

三个纯函数供 `showWorkerPanel` 与单测复用，**不依赖任何 TUI 状态**。

```ts
import {
  buildTabBar,         // 构建 Tab 栏文本（多 worker + 当前选中 + 折叠）
  buildTabContent,     // 构建 Tab 内容（标题 + Task + Tool + Output + Token + 嵌套）
  formatNestedWorkers, // 格式化嵌套 worker 列表（chainIndex 排序 + ↳ 缩进）
  formatWorkerRow,     // 格式化单行 worker（折叠态复用）
} from "./worker-widget.js";
```

设计意图：**渲染逻辑与 TUI 状态完全解耦**，便于单测覆盖（`tests/P4/worker-panel-pure.test.ts` 18 个用例）和未来切换渲染后端（WebUI/HTML）。

#### 数据流（onProgress 链路）

```
wrapWorker (P4/index.ts)
  └─ 注入闭包: onProgress: (p) => updateAgentProgress(workerId, p)
       └─ workerStart (P2/worker.ts)
            └─ executeInBackground 注入 context.onProgress
                 └─ default executor (P2/worker.ts)
                      └─ spawnAgent({ onUpdate, onToolEvent })
                           └─ 流式回调 → context.onProgress
                                └─ updateAgentProgress(workerId, p)
                                     ├─ store.set(workerId, ...)
                                     ├─ latestProgressByWorker.set(workerId, extended)
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
- Tab 面板在每个父 tab 内显示 `Nested workers (N):` 区域，Enter 进入子详情（见上）

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
  showWorkerStatus,        // 折叠态 widget：节流更新（1s 内只刷 1 次）
  clearWorkerStatus,       // 清除折叠态 widget
  updateAgentProgress,     // 更新 AgentProgress 数据（推荐用 wrapWorker 自动注入的闭包）
  registerWorkerTerminated,// 标记 worker 终态 + 调度清理
  showWorkerPanel,         // Tab 面板：/dteam 命令触发（也用于 toggle 关闭）
  buildTabBar,             // 纯函数：构建 Tab 栏（也可用于单测或自定义 UI）
  buildTabContent,         // 纯函数：构建 Tab 内容
  formatNestedWorkers,     // 纯函数：格式化嵌套 worker 列表
  installSignalBridge,     // 安装信号桥接（bus → store）
} from "./worker-widget.js";

// 注册 /dteam 命令（入口已存在 P4/index.ts）
pi.registerCommand("dteam", {
  description: "Toggle worker progress panel (multi-worker Tab)",
  handler: (_args, ctx) => showWorkerPanel(ctx),
});

// 折叠态 widget 渲染（自动捕获 tui + 启动 1s tick）
// 已经在 wrapWorker → showWorkerStatus 流程中自动触发
// 无需手动注册 setWidget

// 更新进度数据（推荐用 wrapWorker 自动注入的闭包）
updateAgentProgress(workerId, progress);

// 终态清理
registerWorkerTerminated(workerId, "done");
registerWorkerTerminated(workerId, "failed", errorMsg);

// 安装信号桥接（一次即可，重入会忽略）
installSignalBridge(bus);
```

#### 节流与刷新

- 折叠态：1s 跳秒（`setInterval` 在 widget factory 启动）
- Tab 面板：500ms 跳秒（`panelRefreshTimer` 模块级单例 + `tui.requestRender()`）
- 折叠态节流：1s 内多次 `showWorkerStatus` 只更新 1 次（避免 flicker）

#### 内存管理

- 折叠态 widget factory 抓 `tui` + 启动 tick interval
- `WorkerStatusList.dispose()` 清 `tickTimer` + 清 `activeTui` 引用
- Tab 面板：`closeWorkerPanel()` 幂等关闭（handle.hide + clearInterval + Container.clear + store 同步清理）
- `clearAllWorkerWidgets()` 用于 session shutdown
