# dteam v1 UI 规划

## 目标

输入 `/dteam` 命令弹出面板，500ms 刷新一次，实时显示：
- 当前 goal
- 多个 worker 的状态（pending / running / done / failed）
- 每个 worker 最新的思考或输出

## 参考实现

| 来源 | 做了什么 | 我们取什么 |
|------|---------|-----------|
| ant-colony `ui.ts` | 报告生成（纯文本），无实时面板 | statusIcon / progressBar 工具函数 |
| pi-subagents `render.ts` | 完整的 TUI widget，支持折叠/展开/并行/链式 | widget 渲染模式、Ctrl+O 展开、setWidget API |
| v0 `worker-widget.ts` | /dteam 命令触发展开面板 + 折叠态 widget | registerCommand、showWorkerPanel、500ms 刷新、tab 切换 |

## 数据流

```
orchestrator 主循环
  → pool.update() 改状态
  → 更新全局状态 store（新增 ui-store.ts）
  → ctx.ui.setWidget() 触发 widget 重渲染
  → 折叠态：自动刷新（TUI 框架驱动）
  → 展开态（/dteam）：500ms 定时器 + requestRender()
```

## 新增文件

```
src/
  ui-store.ts     ← 全局 UI 状态（当前 goal、worker 列表、最新输出）
  ui-widget.ts    ← 折叠态 widget（TUI Component）
  ui-panel.ts     ← 展开态面板（/dteam 命令触发）
  ui-render.ts    ← 共用渲染工具（statusIcon、进度条、时间格式化）
```

## 改动文件

```
src/orchestrator.ts  ← 每次 pool.update 后调 uiStore.update()
src/leaf.ts          ← subscribe session 事件 → 推送到 uiStore
src/brancher.ts      ← subscribe session 事件 → 推送到 uiStore
index.ts             ← 注册 /dteam 命令 + 注册 widget
```

## UI 状态模型

```ts
interface UIWorkerState {
  id: string;
  parentId: string | null;
  title: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  /** 最新 3 行输出（leaf 的 text_delta / brancher 的决定） */
  recentOutput: string[];
  /** 当前正在用的工具（leaf 的 bash/write/read 等） */
  currentTool: string | null;
}

interface UIState {
  goal: string;
  workers: UIWorkerState[];
  startedAt: number;
  finishedAt: number | null;
}
```

## 渲染设计

### 折叠态（默认，右侧 widget 区域）

```
⚙ dteam · running (12s)
├ ⚒ root: 实现 JWT 认证
│ └ ⎿ decomposed into 3 sub-tasks
├ ✓ step 1: 用户注册
├ ⚒ step 2: 用户登录
│ └ ⎿ bash: npm test... 3s
└ ◦ step 3: Token 刷新
```

### 展开态（/dteam 触发，全屏面板）

```
╭─────────────────────────────────────────╮
│  dteam · 实现 JWT 认证 · 12s            │
│  3/4 done, 0 failed                     │
├─────────────────────────────────────────┤
│                                         │
│  ✓ t-1: root task                       │
│    decomposed into 3 sub-tasks          │
│                                         │
│  ✓ t-2: step 1 - 用户注册               │
│    done · 5s · 3 tools                  │
│    ⎿ 创建了 register.ts                 │
│                                         │
│  ⚒ t-3: step 2 - 用户登录               │
│    running · 8s · 7 tools               │
│    ⎿ 当前: bash · npm test              │
│    ⎿ 最新: "3 tests passed..."          │
│                                         │
│  ◦ t-4: step 3 - Token 刷新             │
│    pending                              │
│                                         │
╰─────────────────────────────────────────╯
  [q] 关闭  [↑↓] 滚动  [Ctrl+O] 折叠
```

## 实现步骤

1. **ui-store.ts** — 全局 UI 状态管理
2. **ui-render.ts** — 纯渲染工具函数
3. **ui-widget.ts** — 折叠态 widget（ctx.ui.setWidget）
4. **orchestrator.ts** — 在主循环里推送状态到 ui-store
5. **index.ts** — 注册 /dteam 命令 + 绑定 widget
6. **ui-panel.ts** — 展开态面板（可后续迭代）

## v1 UI 不做的事

- ❌ Tab 切换（v1 不需要，worker 数量少）
- ❌ 确认面板（v1 不做 A/B 验收）
- ❌ 信号角标（v1 不做信号系统）
- ❌ 并行 worker 显示（v1 顺序跑）
- ❌ 嵌套子面板（v1 树只有 2 层）
