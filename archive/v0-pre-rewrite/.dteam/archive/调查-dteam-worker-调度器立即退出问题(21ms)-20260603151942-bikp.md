# 修复 wrapWorker status 分支污染 workerStore（21ms 调查已收口）

> **Task 阶段转换说明**：原 task 标题"调查 dteam worker 调度器立即退出问题（21ms）"——explore 阶段已确认该现象**是操作误用**（explore agent 只调了 `worker_create` 没调 `worker_start`），无代码 bug。design 阶段新发现一个**真实代码 bug**：状态栏 widget 不断长出 `unknown/Status check` 行（`wrapWorker` 的 `case "status"` 分支污染 `workerStore`）。本 task 当前**修复目标**聚焦在新发现的代码 bug。

## 基本信息
- ID: 20260603151942-bikp
- 类型: bugfix
- 创建时间: 2026-06-03T07:19:42.106Z
- 状态: todo → in_progress（build 阶段开始时切到 in_progress）

## 目标
- 为什么: 状态栏 widget 区域不断长出 `✓ unknown  Status check  T:0  0.0s` 假行。根因是 `src/P4/index.ts:155-158` `wrapWorker` 的 `case "status"` 分支无条件调 `emitWorkerProgress`，对不存在的 workerId 也会创建 role=unknown 的虚拟记录，且这些记录永远不被清理。worker 21ms 退出加重了本 bug 表现，但本 task 不修 21ms 退出根因。
- 做什么: 修复 `wrapWorker case "status"` 污染 store 的路径；新增/调整 P4 测试覆盖 3 条 status 查询路径；保持 `workerStatus` API 与 `emitWorkerProgress` 内部行为不变；保持 `buildBriefReport` 的 `📊 Worker X: <status>` 输出。

## 范围

**包含**
- 修复 `src/P4/index.ts` 中 `wrapWorker` 的 `case "status"` 分支对 workerStore 的污染（worker 不存在时也写"虚拟"记录）
- 在 `tests/P4/` 新增/调整测试覆盖 status 查询的 3 条路径：worker 不存在 / 存在且 running / 已 done 在 3s 清理窗口内
- 保持 `P2/worker.ts` 的 `workerStatus` API 行为不变（错误路径仍只返回 `{ error }`，不返回 workerId）
- 保持 `P4/renderers.ts` 的 `emitWorkerProgress` 对 create/start/signal/cancel 4 个 case 的现有行为不变

**排除**
- 修复 worker 调度器 21ms 立即退出的根因（独立问题，已确认为操作误用：未调 `worker_start`）
- 重构 dteam status API（保持现状）
- 修改 widget 渲染格式（如 `T:0  0.0s` 截断体验问题）
- 修改 `scheduleTerminationCleanup` 的 3s 窗口时长
- 修改 `buildBriefReport` 的 status 输出文本（保持 `📊 Worker X: <status>`）

## 验收条件（GWT + 测试）

1. **G** widget 处于初始干净状态（store 为空）、
   **W** 连续 10 次调 `dteam status` 查询一个不存在的 workerId、
   **T** widget 区域不出现 `unknown/Status check` 新行，`getStore().size === 0`。

2. **G** worker 存在且 `status="running"`、`role="build"`、`task="原始任务"` 已正确写入 store、
   **W** 调 `dteam status workerId=X`、
   **T** store 中该 worker 的 `role` 仍是 `"build"`、`task` 仍是 `"原始任务"`，未被覆盖为 `"unknown"/"Status check"`。

3. **G** worker 已 done 但 store 记录还在 3s 清理窗口内、`role="explore"`、`task="调研某事"` 已写入 store、
   **W** 调 `dteam status workerId=X`、
   **T** store 中该 worker 的 `role` 仍是 `"explore"`、`task` 仍是 `"调研某事"`，未被覆盖。

4. **G** 新增 `tests/P4/wrapWorker-status.test.ts` 覆盖 status 查询的 3 个分支、
   **W** 跑 `npm test`、
   **T** 所有 P4 测试通过（含新增的 3 个 status 专项测试）。

5. **G** TypeScript 严格模式、
   **W** 跑 `npm run build`、
   **T** 编译成功，零类型错误。

6. **G** 手动回归：先 `dteam run` 启动一个真实 worker → 它跑完后调 `dteam status`、
   **T** widget 显示该 worker 的正常终态（不是 "Status check"），且 3s 后该行按预期被清理消失。

## 阶段记录

### 探索发现

#### A. 21ms 退出的真相（原 task 调查结论，保留）

##### 1. 工具分类（已纠正之前误解）

dteam 工具都是 **dteam 项目自己注册的 pi 扩展工具**（不是 MCP server），分布在：
- `src/P4/index.ts` — 27 个 `pi.registerTool({...})`（task_*/worker_*/memory_*/signal_*/reference_*）
- `src/P4/dteamTool.ts` — 复合 `dteam` 工具的 `handleDteamAction`（list/plan/run/status）
- 工具底层在 `src/P1/task.js`、`src/P1/memory.js`、`src/P1/signal.js`、`src/P2/worker.js` 等

MCP 网关（`pi-mcp-adapter`）把 pi 扩展工具再包成 MCP 工具（如 `dteam` MCP 工具）——这只是协议层包装，**真正的实现仍在 dteam 项目**。

##### 2. worker 调度的两步流程

dteam 项目的 worker **不是一气呵成**的：

| 工具 | 实际函数 | 作用 |
|---|---|---|
| `worker_create` | `workerCreate()` | **仅注册** worker 到 `workers` Map，**不执行** |
| `worker_start` | `workerStart()` | **真正执行** worker（调 runWorker → runSolo/Chain/Team → spawnAgent 调 LLM） |

之前**只调了 `worker_create`，从未调过 `worker_start`**——这就是为什么 worker 永远在 "pending" 状态。

##### 3. config 组合错误（额外发现）

之前传的 worker config：
```typescript
{
  type: "chain",
  options: [{ type: "role", value: "build" }],
  ...
}
```

**这是非法组合**：
- `runChain` 需要 `options: [{ type: "steps", value: ChainStep[] }]`
- `runSolo` 需要 `options: [{ type: "role", value: string }]`
- "chain + role" 没有匹配的 executor

如果之后调 `worker_start`，会立即 throw `'Required option "steps" not found'`，被 runWorker catch 后返回 failed。**不调 start 反而"看起来正常"**——因为 worker_create 本来就不执行。

##### 4. 21ms 退出的真相

`worker_create` 内部**完全是同步的**：
- 校验 config
- `normalizeOptions(config.options)`
- 生成 `workerId = worker-${ts}-${rand}`
- `createContextBuilder(...)`
- `workers.set(workerId, {...})`
- return JSON

**没有任何异步执行**。21ms = MCP 序列化 + 函数调用 + 返回的开销。这就是"立即退出"的根因。

##### 5. dteam.run 是"一键三连"

`dteam` 工具的 `action: "run"`（`handleDteamAction` → `executeRun`）：
1. 调 `workerCreate`（create 阶段）
2. 调 `workerStart` with `background: true`（start 阶段）
3. 自动注入 `onProgress` / `onComplete` 闭包（绑定 workerId）

**这是 dteam 设计好的"正确用法"**——之前手写 `worker_create` + `options` 跳过了 run action 里的关键步骤。

##### 6. 关键文件位置

- `src/P2/worker.ts:292-326` — workerCreate（仅注册）
- `src/P2/worker.ts:342-450` — workerStart（真正执行 + 错误处理）
- `src/P2/solo.ts:30` — `getRequiredOption(config.options, "role")`
- `src/P2/chain.ts:32` — `getRequiredOption(config.options, "steps")`
- `src/P4/dteamTool.ts:163-216` — `executeRun`（一键三连）
- `agents/build.md` — 角色定义（frontmatter 含 model: deepseek/deepseek-reasoner）
- `/Users/diwu/.pi/agent/dteam/dconfig.json` — 用户配置（覆盖 agents/*.md 的 model）

#### B. 状态栏长出 `unknown/Status check` 的根因（本轮新发现，是本 task 修复对象）

虽然 21ms 退出的根因是"未调 worker_start"（操作误用），但状态栏"不断长出 unknown Status check"是**真实的代码 bug**——独立于 21ms 退出问题。

**根因链**：

1. **入口**：`src/P4/index.ts:155-158`（`wrapWorker` 的 `case "status"` 分支）
   - 每次 `dteam status` / `worker_status` 调用都走这里
   - **无条件**调 `emitWorkerProgress(extensionApi, workerId, status, "Status check")`，无论 worker 是否存在

2. **写入 store**：`src/P4/renderers.ts:268-279`（`emitWorkerProgress`）
   - `if (!workerStore.has(workerId))` → 创建 `role: "unknown"`、`task: "Status check"` 的"虚拟"记录
   - 触发 `pi.events.emit("dteam:render-status")` → 状态栏 widget 重绘

3. **数据源缺失**：`src/P2/worker.ts:740-745`（`workerStatus` 错误路径）
   - worker 不存在时只返回 `{ error: "Worker not found: ${workerId}" }`，**不返回 `workerId` 字段**
   - `wrapWorker:133` 兜底 `workerId = parsed.workerId || params.workerId` → 仍能用 params.workerId 写 store

4. **永不清理**：`emitWorkerProgress` 不调 `scheduleTerminationCleanup`
   - 真正的清理只发生在 `registerWorkerTerminated`（done/failed 终态）
   - "虚拟"记录永远留在 store 里，widget 每次重绘都显示

5. **widget 渲染**：`src/P4/worker-widget.ts:289-313`（`formatWorkerRow`）
   - 从 store 读所有记录，每条渲染为单行 `<icon> <role>  <task>  工具:N  X.Xs`
   - 终端宽度窄时 `truncateToWidth` 截断为 `T:0  0.0s`（用户实际看到的就是这个）

**触发场景**：

- 用户用 `dteam run` 创建 worker → worker 21ms done（虽然 dteam.run 会调 start，但因为是 21ms done 实质上没真正跑）→ `registerWorkerTerminated` 调度 3s 后 `store.delete`
- 3s 后 store 已清；用户/LLM 多次调 `dteam status workerId=X`（X 是已清理 ID）
- 每次 status 查询都新建一条 `unknown/Status check` 假记录
- widget 区域表现为"不断长出新行"（实则每次都新建一条）

**关联性**：21ms 退出加重了本 bug 表现（频繁 done → 频繁清理 → 频繁 status 查询）。但本 task 的修复目标是**status 污染路径**（独立 bug），21ms 退出是 explore agent 的操作误用无需修代码。

### 讨论决策

> 整合主 LLM 初版方案 + design agent（worker-1780473028894-qdj2）增量：具体代码改法（方式 1/2）、复用 mock pattern、commit 标题、架构选择

#### 复杂度评估

- **涉及文件**：`P4/index.ts`（主修）、`tests/P4/`（新增 1 个文件）
- **影响范围**：仅 status 查询路径
- **风险**：低（局部修改，单分支移除）
- **结论**：**简单设计** → 直接执行

#### 候选方案对比

| 方案 | 改动点 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|---|
| **A. 检测 error 跳过** | wrapWorker case "status" 内检 `parsed.error`，error 时跳过 emitWorkerProgress | 改动小（1-3 行） | 治标：worker 存在时仍会覆盖 task 文本为 "Status check"，污染 store 显示 | ⭐⭐ |
| **B. 永不调 emitWorkerProgress** | wrapWorker case "status" 完全不调 emitWorkerProgress | 治本、语义正确、4 个 case 行为不变、单分支最小修改 | 极少数 LLM 习惯用 status "刷新" widget 的场景不被支持 | ⭐⭐⭐⭐⭐ |
| **C. emitWorkerProgress 加 cleanup** | renderers.ts emitWorkerProgress 内调度 5s 后 delete | 通用防护，挡掉所有"虚拟"记录 | 违反"不改 renderers.ts"约束；治标（治不了 task 文本覆盖）；cleanup 时长难定 | ⭐ |
| **D. B + C 双管齐下** | B + C | 双保险 | 违反约束 + 过度设计 + C 解决不了 B 已解决的问题 | ⭐ |

#### 最终方案：**B**

`wrapWorker` 的 `case "status"` **不再调** `emitWorkerProgress`。

**选型理由（合并）**：

1. **语义正确**：status 是查询动作（read），不是生命周期事件（write）。`emitWorkerProgress` 名字就是 "emit progress"，status 查询不应"emit 进度"——把它当事件写 store 是语义错位。
2. **治本**：源头是 `case "status"` 不应调 `emitWorkerProgress`，去掉该调用即根治"未知 worker 也会被写 store"和"task 文本被覆盖"两个症状。
3. **不影响真实进度显示**：worker 存在且 running 时，状态栏 widget 已通过 `updateAgentProgress`（在 `start` 分支注入的 `onProgress` 闭包）收到实时进度，**不依赖** status 查询来更新显示。
4. **user-facing 反馈保留**：`buildBriefReport` 仍输出 `📊 Worker X: <status>`，用户在 TUI 看到 brief，知道查询到了什么。
5. **最小爆炸半径**：单分支移除，create/start/signal/cancel 4 个 case 完全不变。
6. **满足所有约束**：不修改 P2/worker.ts、不修改 renderers.ts、只改 P4/index.ts 的 case "status" 分支。

#### 实现细节（design agent 增量）

**方式 1（推荐）**：把 `emitWorkerProgress` 移入 switch 内部 4 个 case，case "status" 显式不调：

```typescript
// src/P4/index.ts:wrapWorker 内部，switch 段（约 line 141-161）
switch (workerAction) {
    case "create":
        status = "pending";
        task = parsed.config?.task || "Worker created";
        emitWorkerProgress(extensionApi, workerId, status, task);
        break;
    case "start":
        status = "running";
        task = "Executing...";
        emitWorkerProgress(extensionApi, workerId, status, task);
        break;
    case "signal":
        status = "running";
        task = `Signal: ${params.signalType}`;
        emitWorkerProgress(extensionApi, workerId, status, task);
        break;
    case "cancel":
        status = "failed";
        task = "Cancelled";
        emitWorkerProgress(extensionApi, workerId, status, task);
        break;
    case "status":
        // status 是查询动作（read），不是生命周期事件（write）。
        // 不调 emitWorkerProgress 避免污染 store：
        //   1) 不存在的 workerId 不会再被创建"虚拟"记录
        //   2) 已存在的 worker 不会被覆盖 task 文本为 "Status check"
        // user-facing 反馈由 buildBriefReport 提供（"📊 Worker X: <status>"）
        break;
}
```

**方式 2（备选）**：保留 switch 外统一调用，加条件包裹：

```typescript
// switch 之后（原 line 163）
if (workerAction !== "status") {
    emitWorkerProgress(extensionApi, workerId, status, task);
}
```

build agent 选其一实施。**推荐方式 1**（更显式、4 个 case 各管各的、case "status" 的不调意图写进注释、未来扩展更安全）。

#### 技术选型

- **不改 `P2/worker.ts`**：`workerStatus` 错误路径保持现状（只返回 error），不强制返回 workerId。问题源头不在 P2。
- **不改 `renderers.ts` emitWorkerProgress**：保持对 4 个 case 的现有行为，最小爆炸半径。
- **只在 `P4/index.ts` wrapWorker 修**：这是问题真正的源头，治本。

#### 实施步骤（按 build agent 可执行粒度）

**步骤 1：改源码（`src/P4/index.ts`）**
- 定位：`wrapWorker` 函数（line 36），switch 段（line 141-161），case "status"（line 155-158）
- 定位：switch 外部的 `emitWorkerProgress(extensionApi, workerId, status, task)`（line 163）
- 操作 1：把 `emitWorkerProgress` 调用移入 switch 内部 4 个 case（create/start/signal/cancel）的每个 case 末尾
- 操作 2：case "status" 不调 `emitWorkerProgress`（按方式 1 加注释说明）
- 操作 3：删除 switch 外部的 `emitWorkerProgress` 调用

**步骤 2：新增测试（`tests/P4/wrapWorker-status.test.ts`）**
- 复用 `tests/P4/worker-widget.test.ts` 的 mock pattern（`makeMockTheme` + `makeMockCtx` + `getStore`/`resetStore`/`setProgress`）
- mock `workerStatus`（从 `src/P2/worker.js`）返回受控 JSON
- 测试 1：worker 不存在路径
  - G：store 初始为空
  - W：调 `wrapWorker(workerStatus, "status", pi)` 查询不存在的 workerId
  - A：mock `workerStatus` 返回 `{ content: JSON.stringify({ error: "Worker not found: X" }) }`
  - T：`getStore().size === 0`，store 中无该 workerId
- 测试 2：worker 存在且 running 路径
  - G：store 已有 worker 记录（`role: "build"`、`task: "原始任务"`、`status: "running"`）
  - W：调 `wrapWorker(workerStatus, "status", pi)` 查询该 workerId
  - A：mock `workerStatus` 返回 `{ content: JSON.stringify({ workerId, status: "running" }) }`
  - T：store 中该 worker 的 `task` 仍是 "原始任务"（不是 "Status check"）、`role` 仍是 "build"（不是 "unknown"）
- 测试 3：worker 已 done 在 3s 窗口内路径
  - G：store 已有 worker 记录（`role: "explore"`、`task: "调研某事"`、`status: "done"`）
  - W：调 `wrapWorker(workerStatus, "status", pi)` 查询该 workerId
  - A：mock `workerStatus` 返回 `{ content: JSON.stringify({ workerId, status: "done" }) }`
  - T：store 中该 worker 的 `task` 仍是 "调研某事"（不是 "Status check"）、`role` 仍是 "explore"（不是 "unknown"）

**步骤 3：验证**
- `npm test` → 所有 P4 测试通过（含新增 wrapWorker-status.test.ts 的 3 条）
- `npm run build` → 编译成功，零类型错误
- 手动回归（可选）：`dteam run` 启动一个真实 worker → 调 `dteam status` → widget 不再长出 "Status check"

**步骤 4：commit**
- 标题：`修复：wrapWorker status 分支不再污染 workerStore`
- 范围：仅 `src/P4/index.ts`（1 个文件改动）+ `tests/P4/wrapWorker-status.test.ts`（1 个新文件）

#### 依赖关系

- 测试 `tests/P4/worker-widget.test.ts` 已有 mock 基础设施（`makeMockTheme`、`makeMockCtx`、`getStore`/`resetStore`/`setProgress`）可复用
- 测试需从 `src/P2/worker.js` 导入 `workerStatus` 并 mock（参考 `tests/P4/dteamTool.test.ts` 的 mock pattern）
- `tests/P4/` 已有 5 个测试文件，新文件命名遵循 `tests/P4/<feature>.test.ts` 约定

#### 架构选择

- **架构模式**：**保留现有 P4 渲染架构**（workerStore + emitWorkerProgress + updateAgentProgress + scheduleTerminationCleanup）
- **选择理由**：
  1. bug 是 P4 层的事件源污染（status 被错当成事件），**不涉及架构调整**
  2. 现有的 store / cleanup 机制正确，问题只是 `case "status"` 用错了事件源——纠正事件源即修复
  3. 任何"加 cleanup""加版本号""加 status flag"等架构级修改都是**过度设计**，违反最小化原则
  4. 单分支修改（case "status" 不调 emitWorkerProgress）保持架构稳定，4 个 case 行为完全不变
- **依赖关系**：无需新增/修改任何 P0/P1/P2/P3 模块

#### 风险与回退

- **风险 1**：极少数场景下 LLM 用 status 查询"刷新" widget 显示
  - **判定**：不合理用法，应当用 `updateAgentProgress` 走真实进度
  - **缓解**：本 task 不接受此回退；如确有必要，close agent 在收口时可提 follow-up
- **风险 2**：测试 mock 与真实 `wrapWorker` 调用链路不完全一致
  - **缓解**：参考 `tests/P4/worker-widget.test.ts` 的现有 mock pattern；新增测试复用同一组 helper
- **回退方案**：`git revert` 恢复 `emitWorkerProgress` 调用即可（恢复到 switch 外的统一调用方式）

#### 验收条件

> 完整 6 条 GWT 见 task 顶部 `## 验收条件` section（不重复）。本节只强调 design agent 增量要求：测试文件必须用 `tests/P4/wrapWorker-status.test.ts` 命名，复用 `tests/P4/worker-widget.test.ts` 的 mock 基础设施。

### 执行记录

**build agent 阶段开始**（2026-06-03）：开始执行修复 + 测试任务。

**步骤 1：源码修复（src/P4/index.ts wrapWorker）**

- 改动点：把 `emitWorkerProgress` 调用从 switch 段**外部**（原 line 163）移入 switch 内部 4 个 case（create/start/signal/cancel）的末尾
- `case "status"` 显式不调 `emitWorkerProgress`，加注释说明不污染 store 的理由
- 选型：方式 1（更显式 + 注释说明）

具体改动定位（修改前/后）：

- 修改前（line 141-163）：switch 内部仅设置 `status`/`task` 变量；switch 外部统一调 `emitWorkerProgress(extensionApi, workerId, status, task)`
- 修改后（line 143-179）：4 个 case 末尾各自调 `emitWorkerProgress`；`case "status"` 留空 + 注释
- 额外：把 `wrapWorker` 函数加上 `export` 修饰符（仅供单测调用，附注释说明）

**步骤 2：新增测试（tests/P4/wrapWorker-status.test.ts）**

- 3 个专项测试：
  1. `worker 不存在时，store 保持为空（不创建 unknown/Status check 虚拟记录）`
  2. `worker 存在且 running 时，已存在记录的 task/role 不被覆盖为 'Status check'/'unknown'`
  3. `worker 已 done 且 store 记录在 3s 清理窗口内时，task/role 不被覆盖`
- 4 个回归测试（保障其他 case 行为不变）：
  1. `worker 不存在时，buildBriefReport 返回错误信息（含 workerId）`
  2. `worker 存在时，buildBriefReport 返回 '📊 Worker X: <status>' 格式`
  3. `case 'create' 仍调 emitWorkerProgress（写 store）`
  4. `case 'start' 仍调 emitWorkerProgress（写 store）`

**步骤 3：验证结果**

- `npm test` → **315 / 315 passed**（含新增 wrapWorker-status.test.ts 7 个测试）
- `npm run build` → **编译成功，零类型错误**（tsc strict mode）
- P4 单测专项 → **125 / 125 passed**（含新增 7 个 status 测试）

**步骤 4：commit**

- 标题：`修复：wrapWorker status 分支不再污染 workerStore`
- 范围：`src/P4/index.ts`（1 个文件改动）+ `tests/P4/wrapWorker-status.test.ts`（1 个新文件）
- commit hash：`f6f0862fb68c25fa135e7db584c41648f9efa7dd`（完整 hash），短 hash `f6f0862`
- 变更统计：2 files changed, 331 insertions(+), 6 deletions(-)
- 详细 commit 信息见 `git log -1 f6f0862`

### 收口记录

**关闭时间**：2026-06-03

**最终交付物**：
- commit：`f6f0862 修复：wrapWorker status 分支不再污染 workerStore`
- 改动：`src/P4/index.ts`（22 行：把 emitWorkerProgress 移入 switch 内 4 个 case，case "status" 不调）+ `tests/P4/wrapWorker-status.test.ts`（315 行：3 专项 + 4 回归测试）
- 测试：315 / 315 passed
- build：tsc strict mode 编译成功

**最终方案**：方案 B（wrapWorker case "status" 移除 emitWorkerProgress 调用，方式 1 — 移入 switch 内 4 个 case）

**阶段流程**：
- explore：原 21ms 调查（已确认为操作误用）
- design：worker-1780473028894-qdj2（design agent），补具体代码改法（方式 1/2 + 行号 + mock 复用）
- build：worker-1780473569254-5fon（build agent），按方式 1 实施 + 7 个新测试 + commit
- close：本次

**遗留 / Follow-up**：
- worker 调度器 21ms 退出的根因（独立 bug，已确认为操作误用，无代码 bug，无需修）
- widget 渲染格式 `T:0  0.0s` 截断体验问题（task 范围已排除，留用户决定是否单独开 task）
- scheduleTerminationCleanup 3s 窗口时长（task 范围已排除）

**经验沉淀**：
- dteam 状态栏 widget 的"虚拟"记录是 status 查询污染产生的——修复点是事件源（case "status"）而非 cleanup 机制
- 工具 API 的 status 返回值要明确分清"写事件"和"读事件"语义
- 测试 mock 复用：`tests/P4/wrapWorker-status.test.ts` 复用了 `tests/P4/worker-widget.test.ts` 的 `makeMockTheme` / `makeMockCtx` / `getStore` / `resetStore` / `setProgress` 基础设施
- 为支持单测，`wrapWorker` 函数加上 `export` 修饰符（仅供单测调用）—— 工程实践 OK
