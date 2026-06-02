# 修复-check发现的5个bug-showWorkerStatus+动态import+dispose清理

## 基本信息- ID: 20260602154341-17nf
- 类型: bugfix
- 创建时间: 2026-06-02T07:43:41.857Z
- 状态: Done

## 目标
- 为什么: 上一轮 build agent 完成 TUI 多 worker widget 实施后，check agent 验收发现 4 个 BLOCKER/FAIL bug 阻塞 AC2/AC7/AC9。bug 根因明确、修复方案已在 check 报告中给出。必须修完后重新 check 才能进入 close 阶段。
- 做什么: 修复 check agent 在 task 20260602024724-r887「验收报告」section 发现的 5 个问题：
1. [BLOCKER AC2/AC9] showWorkerStatus workerId = 'unknown'，多 worker 状态互相覆盖
2. [FAIL AC2 配套] P2 solo/chain/team inner ID ≠ outer ID
3. [FAIL AC7] dteamTool 动态 import 丢事件
4. [FAIL AC9] WorkerStatusList/WorkerFullscreenView dispose 不清 interval 内存泄漏
5. [测试缺] multi-worker.test.ts 缺 '2 worker 并行不覆盖' 用例

完成后 npm test 全绿，AC2/AC7/AC9 全部 PASS。

## 范围
- 包含: 5 项 bug 修复 + 配套测试 + 验证
- 排除: 不重做 widget 整体逻辑、不改 README（除非 API 变化）、不动 P3/P1 业务逻辑

## 验收条件（GWT + 测试）

- [x] AC1: `showWorkerStatus` 新签名 `showWorkerStatus(ctx, workerId, state)`，workerId 必传 ✅ PASS: `showWorkerStatus(ctx: ExtensionContext, workerId: string, state: WorkerWidgetState): void` 签名在 `worker-widget.ts:488`；旧 `(state as any).workerId ?? "unknown"` 已彻底删除
- [x] AC2: `P4/index.ts:167` 调用 `showWorkerStatus` 时传正确 workerId ✅ PASS: `P4/index.ts:168` 调 `showWorkerStatus(ctx, workerId, { ... } as any)` 已传 workerId 第二参数
- [x] AC3: store 中多 worker 独立记录，不互相覆盖（新增测试覆盖） ✅ PASS: 静态实测 + 集成测试：调 `showWorkerStatus` 传 `"worker-A"` 和 `"worker-B"`，store.size=2，两条记录独立，无 `"unknown"` 合并。`multi-worker.test.ts:222-244` 新增 '2 worker 并行不覆盖' 用例
- [x] AC4: `P2/solo.ts/chain.ts/team.ts` `runSolo/Chain/Team` 接受 `parentWorkerId` 形参，emit 信号时合并 ✅ PASS: `P2/solo.ts:28` / `chain.ts:31` / `team.ts:36` 都加 `parentWorkerId?: string` 形参；emit 用 `const workerId = parentWorkerId ?? innerId` 替换 solo-/chain-/team-${ts}
- [x] AC5: `P3/worker.ts:runWorker` 透传 `parentWorkerId` ✅ PASS: `P3/worker.ts:40-44` 把 `parentWorkerId` 透传给 `runSolo` / `runChain` / `runTeam`
- [x] AC6: `P2/worker.ts:executeInBackground` 把 outer workerId 传进 `runWorker` ✅ PASS: `P2/worker.ts:411` 调 `runWorker(worker.config, worker.bus, worker.memory, wrappedExecutor, workerId)` —— outer workerId 作为第 5 形参传入
- [x] AC7: `dteamTool.ts` 改静态 `import from "./worker-widget.js"` ✅ PASS: `P4/dteamTool.ts:17` 静态 `import { updateAgentProgress, registerWorkerTerminated } from "./worker-widget.js"`；无 `import("./worker-widget.js").then(...)` 残留（grep 全代码 + 过滤注释确认）
- [x] AC8: `WorkerStatusList.dispose()` 清 `tickTimer` + `activeTui = null` ✅ PASS: `worker-widget.ts:230-234` `WorkerStatusList.dispose()` 调 `clearTick()` + `activeTui = null`；`clearTick` 在 `worker-widget.ts:476-481` 实现：清 `tickTimer` 后置 null
- [x] AC9: `WorkerFullscreenView.dispose()` 清 `fullscreenRefreshTimer` ✅ PASS: `worker-widget.ts:365-369` `WorkerFullscreenView.dispose()` 调 `clearInterval(fullscreenRefreshTimer)` 并 `fullscreenRefreshTimer = null`
- [x] AC10: `tests/integration/multi-worker.test.ts` 新增 '2 worker 并行不覆盖' 用例 ✅ PASS: `tests/integration/multi-worker.test.ts` 新增 3 个用例（>DoD 要求的 1 个）：'2 worker 并行不覆盖' / 'runTeam parentWorkerId 透传' / 'runSolo parentWorkerId 透传'，基线 255 → 258 = +3
- [x] AC11: 现有 widget / store / multi-worker 测试同步更新到新签名 ✅ PASS: `tests/P4/worker-widget.test.ts` 已全部同步到新签名 `showWorkerStatus(ctx as any, "w-1", { ... } as any)`（共 4 处调用方）；`store.test.ts` / `multi-worker.test.ts` 不依赖 showWorkerStatus 旧签名，无需改动
- [x] AC12: `npm run build` 无错 ✅ PASS: 实际跑过 `npm run build`（= `tsc`），无任何输出 = 无错误；`tsc` 严格模式通过
- [x] AC13: `npm test` 全绿（基线 255 + 至少 1 新增 = ≥256） ✅ PASS: 实际跑过 `npm test`：19 文件 / 258 测试全过（基线 255 + 3 新增 = 258），耗时 1.4s

## 阶段记录

### 探索发现

> 来源：上一轮 check agent（worker-1780383050825-b4fw）验收 task 20260602024724-r887 的报告。
> check agent 已独立验证 build + test，4 个 bug 全部确认真实存在。

#### 5 个 Bug 根因（已 check agent 独立验证）

| # | 严重度 | 文件:行 | 根因 | 影响 |
|---|---|---|---|---|
| 1 | 🔴 BLOCKER | `src/P4/worker-widget.ts:485` | `workerId: (state as any).workerId ?? "unknown"` —— `WorkerWidgetState` 类型无 workerId 字段，永远 fallback 到 "unknown" | 多 worker 状态合并到同一条 store 记录，**AC2 多 worker 并行完全失效** |
| 2 | 🔴 BLOCKER | `src/P4/index.ts:167` | 调 `showWorkerStatus(ctx, {...})` 没传 workerId | 配合 Bug #1，wrapWorker 启动的 worker 全部归 "unknown" |
| 3 | 🟠 FAIL | `src/P2/solo.ts:19` / `chain.ts:25` / `team.ts:31` | runSolo/Chain/Team emit 用 `solo-${ts}` / `chain-${ts}` / `team-${ts}` 内部 ID，跟 wrapWorker 给的 `worker-${ts}-${random}` 不同 | outer 清时 inner 残留；AC3 部分 FAIL |
| 4 | 🟠 FAIL | `src/P4/dteamTool.ts:246, 251` | `import("./worker-widget.js").then(...)` 动态 import 是异步，进度事件会堆积/丢失 | dteam action=run 路径 onProgress/onComplete 失效，**AC7 FAIL** |
| 5 | 🟠 FAIL | `src/P4/worker-widget.ts:230, 360` | `WorkerStatusList.dispose()` 和 `WorkerFullscreenView.dispose()` 都只 `disposedCount += 1`，**不清 `tickTimer` 和 `fullscreenRefreshTimer`** | setWidget 被新 factory 替换时旧 interval 泄漏，**AC9 内存泄漏 FAIL** |
| 6 | 🟡 MINOR | `tests/integration/multi-worker.test.ts` | 缺"2 worker 并行不互相覆盖"核心 case（虽然 store.test.ts 测了 Map 行为） | AC2 集成测试覆盖不足 |

#### 关键代码引用

```ts
// src/P4/worker-widget.ts:485 (Bug #1)
workerId: (state as any).workerId ?? "unknown",   // ← 永远 "unknown"

// src/P4/worker-widget.ts:230 (Bug #5)
dispose(): void {
    disposedCount += 1;   // ← 不清 tickTimer
}

// src/P4/dteamTool.ts:246 (Bug #4)
import("./worker-widget.js").then((mod) => {     // ← 动态 import
    mod.updateAgentProgress(workerId, p);
});
```

#### 外部约束

- 项目分层 P0→P1→P2→P3→P4，P4 可调 P2 接口但不应 import P2 内部
- 已存在的 `WorkerProgressStore` 在 P4/renderers.ts
- 现有 14 个 widget 测试 + 23 store 测试 + 3 integration 测试（255 总数）
- 现有 19 文件测试套件已全绿
- npm test 会先跑 npm run build（pretest hook）

### 讨论决策

#### 修复策略

**5 项逐一修，最小改动 + 配套测试**。所有方案由 check agent 给出且已独立验证。

#### 步骤拆解（按依赖顺序）

**阶段 A：修 Bug #1 #2（最关键，BLOCKER）**

1. **`P4/worker-widget.ts`**：修改 `showWorkerStatus` 签名
   - 改为 `showWorkerStatus(ctx: ExtensionContext, workerId: string, state: WorkerWidgetState)`
   - 删掉 `(state as any).workerId ?? "unknown"` 的 hack
   - 直接用入参 `workerId`

2. **`P4/index.ts:167`**：修改调用
   ```ts
   showWorkerStatus(ctx, workerId, { /* state */ });
   ```

**阶段 B：修 Bug #3（inner ID 一致性）**

3. **`P2/team.ts / chain.ts / solo.ts`**：让 inner emit 知道 outer workerId
   - 方案：`runSolo/Chain/Team` 接受 `parentWorkerId?: string` 形参
   - 内部 emit 信号时用 `parentWorkerId ?? this.workerId`
   - 透传给 P3/worker.ts 的 `runWorker`

4. **`P3/worker.ts`**：`runWorker` 透传 `parentWorkerId` 给下层

5. **`P2/worker.ts:executeInBackground`**：调用 `runWorker(config, bus, memory, executor, parentWorkerId)`
   - 传 `worker-${ts}-${random}` 进去作为 parentWorkerId

**阶段 C：修 Bug #4（dteam 静态 import）**

6. **`P4/dteamTool.ts`**：改静态 import
   ```ts
   import { updateAgentProgress, registerWorkerTerminated } from "./worker-widget.js";
   // 删掉 import("./worker-widget.js").then(...)
   ```

**阶段 D：修 Bug #5（dispose 内存泄漏）**

7. **`P4/worker-widget.ts`**：
   - `WorkerStatusList.dispose()` 调 `clearTick()` + `activeTui = null`（如果当前 active）
   - `WorkerFullscreenView.dispose()` 调 `clearFullscreenTimer()`
   - `clearTick` / `clearFullscreenTimer` 在已有 helper 中（如果没就抽出来）

**阶段 E：补测试（Bug #6）**

8. **`tests/integration/multi-worker.test.ts`**：新增 1 个用例
   - mock 2 个 worker 并行启动
   - 验证 store 中有 2 条独立 workerId 记录
   - 验证 showWorkerStatus 第二参数 workerId 必传

9. **同步更新 widget 测试**：因为 `showWorkerStatus` 签名变了，所有调用方测试要更新

#### 接口契约

**`P4/worker-widget.ts`**：
```ts
// 旧: showWorkerStatus(ctx, state)
// 新:
export function showWorkerStatus(
    ctx: ExtensionContext,
    workerId: string,                    // ← 新增必传
    state: WorkerWidgetState,             // ← workerId 不再放在 state 里
): void
```

**`P2/team.ts / chain.ts / solo.ts`**：
```ts
// 旧: runSolo(config, bus, memory, executor)
// 新: 接受 parentWorkerId
export async function runSolo(
    config: WorkerConfig,
    bus: SignalBus,
    memory: MemoryAdapter,
    executor: Executor,
    parentWorkerId?: string,             // ← 新增
): Promise<SoloResult>
```

**`P3/worker.ts`**：
```ts
export async function runWorker(
    config: WorkerConfig,
    bus: SignalBus,
    memory: MemoryAdapter,
    executor: Executor,
    parentWorkerId?: string,             // ← 新增
): Promise<OrchestratorResult>
```

#### 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 改 showWorkerStatus 签名破坏现有 14 个 widget 测试 | 高 | 中 | 同步更新所有调用方 + 测试 |
| 改 runSolo/Chain/Team 签名破坏 P3/worker.ts 测试 | 中 | 中 | 同步更新 runWorker 调用方 |
| dispose 改 clearInterval 时机不当 | 低 | 中 | 改用 module-level helper 函数 `clearTick()` / `clearFullscreenTimer()` |
| multi-worker 集成测试 mock spawnAgent 起 2 worker 阻塞 | 中 | 低 | 用 vi.fn() 返回 immediate-resolve promise |

#### DoD

- [ ] 5 项 bug 全部修复
- [ ] npm run build 无错
- [ ] npm test 全绿（基线 255 + 至少 1 新增 = ≥256）
- [ ] 现有 14 个 widget 测试不破坏
- [ ] 现有 23 个 store 测试不破坏
- [ ] 现有 3 个 multi-worker 测试不破坏
- [ ] 新增 ≥1 个 multi-worker 用例覆盖"2 worker 并行不覆盖"

### 执行记录（2026-06-02 build agent 修复完成）

**Worker**：`worker-1780386396994-ze80`（minimax-cn/MiniMax-M3, solo 模式, pragmatist 风格, 40 步）
**基线**：255 测试通过
**最终**：19 文件 / **258 测试通过**（基线 255 + 3 新增）
**Build**：`npm run build` 无错误

#### 5 项 bug 全部修复 ✅

| # | 修复 | 验证 |
|---|---|---|
| 1 | `showWorkerStatus` 新签名 `(ctx, workerId, state)` | `worker-widget.ts:488` |
| 2 | `P4/index.ts` 调用时传 workerId 第二参数 | `index.ts:172` 调 `showWorkerStatus(ctx, workerId, {...})` |
| 3 | `P2/solo.ts/chain.ts/team.ts` 加 `parentWorkerId` 形参 | 3 文件 `parentWorkerId?: string` 入参；emit 用 `parentWorkerId ?? innerId` |
| 4 | `dteamTool.ts` 改静态 import | `import { updateAgentProgress, registerWorkerTerminated } from "./worker-widget.js"` |
| 5 | `dispose()` 清 interval | `WorkerStatusList.dispose` 调 `clearTick() + activeTui = null`；`WorkerFullscreenView.dispose` 调 `clearInterval(fullscreenRefreshTimer)` |

#### 改动文件清单

- **修改**：
  - `src/P4/worker-widget.ts`（showWorkerStatus 签名 + dispose 清理 + state 主键修复）
  - `src/P4/index.ts`（调 showWorkerStatus 传 workerId）
  - `src/P2/solo.ts`（加 parentWorkerId 形参）
  - `src/P2/chain.ts`（加 parentWorkerId 形参 + 透传给子 step）
  - `src/P2/team.ts`（加 parentWorkerId 形参）
  - `src/P3/worker.ts`（runWorker 透传 parentWorkerId）
  - `src/P2/worker.ts`（executeInBackground 把 outer workerId 传 runWorker）
  - `src/P4/dteamTool.ts`（静态 import）
  - `tests/P4/worker-widget.test.ts`（同步更新到新 showWorkerStatus 签名）
- **新增**：
  - `tests/integration/multi-worker.test.ts` 加 "2 worker 并行" 用例

#### 关键修复点确认 ✅

- ✓ `showWorkerStatus(ctx, workerId, state)` 签名正确（`worker-widget.ts:488`）
- ✓ store 主键用真实 workerId 而非 "unknown"
- ✓ P2 emit 链路用 `parentWorkerId ?? innerId` 合并
- ✓ dispose 真正清 interval（`clearTick` / `clearInterval`）
- ✓ dteamTool 静态 import 无异步丢事件

#### DoD 验证 ✅

- [x] 5 项 bug 全部修复
- [x] `npm run build` 无错
- [x] `npm test` 全绿：19 文件 / **258 测试**（基线 255 + 3 新增）
- [x] 现有 14 个 widget 测试不破坏（同步更新到新签名）
- [x] 现有 23 个 store 测试不破坏
- [x] 现有 3 个 multi-worker 测试不破坏（+ 1 新增覆盖"2 worker 并行"）

#### 遇到的问题

- 第 1 步后 `npm run build` 失败（`showWorkerStatus` 签名变化导致所有调用方类型不匹配）→ 同步更新 `P4/index.ts:172` 和测试文件到新签名
- `P2/solo.ts/chain.ts/team.ts` 加 `parentWorkerId` 形参后，链式调用（chain → solo/team）也要透传 → 在 `chain.ts:runChain` 和 `runChainStep` 同步加

#### 未完成 / 后续

- AC10 性能（5 worker × 5min）仍需手动验证，单元/集成测试无法覆盖
- session reload 时 store 持久化（来自上一轮设计的 P2 优化项）


### 验收报告（2026-06-02 check agent 验收完成）

**Worker**: check agent（minimax-cn/MiniMax-M3, fresh context, 验证者模式）
**结论**: ✅ **READY TO CLOSE**（13/13 AC PASS + Bug #1-#5 全部确认修复 + 0 引入新 bug）

#### 维度 1: 13 条 AC 验收

| AC | 结果 | 证据 |
|---|---|---|
| AC1 | ✅ PASS | `worker-widget.ts:488` 新签名 `showWorkerStatus(ctx, workerId, state)`；旧 `(state as any).workerId ?? "unknown"` 已彻底删除 |
| AC2 | ✅ PASS | `P4/index.ts:168` 调 `showWorkerStatus(ctx, workerId, {...} as any)` |
| AC3 | ✅ PASS | **静态实测 + 集成测试**：2 个不同 workerId 调 showWorkerStatus，store.size=2，2 条独立记录，无 "unknown" |
| AC4 | ✅ PASS | `P2/solo.ts:28` / `chain.ts:31` / `team.ts:36` 加 `parentWorkerId?`；emit 用 `parentWorkerId ?? innerId` |
| AC5 | ✅ PASS | `P3/worker.ts:40-44` 透传 parentWorkerId |
| AC6 | ✅ PASS | `P2/worker.ts:411` `runWorker(..., workerId)` 把 outer ID 传入 |
| AC7 | ✅ PASS | `P4/dteamTool.ts:17` 静态 import；无 `.then(...)` 残留（注释中提及"之前用"是历史描述） |
| AC8 | ✅ PASS | `worker-widget.ts:230-234` WorkerStatusList.dispose → `clearTick()` + `activeTui = null` |
| AC9 | ✅ PASS | `worker-widget.ts:365-369` WorkerFullscreenView.dispose → `clearInterval(fullscreenRefreshTimer)` + `= null` |
| AC10 | ✅ PASS | multi-worker.test.ts 新增 3 个用例（>DoD 要求的 +1） |
| AC11 | ✅ PASS | worker-widget.test.ts 4 处调用全部同步到新签名；store.test.ts 无依赖 |
| AC12 | ✅ PASS | 实际跑 `npm run build`（= tsc），无错 |
| AC13 | ✅ PASS | 实际跑 `npm test`：19 文件 / 258 测试全过（基线 255 + 3 新增） |

#### 维度 2: 原 5 个 bug 修复验证

| Bug | 状态 | 验证 |
|---|---|---|
| #1 `workerId ?? "unknown"` | ✅ 已修 | grep 全文无残留 `workerId.*\?\?.*"unknown"`；AC1/AC3 静态实测通过 |
| #2 `P4/index.ts` 未传 workerId | ✅ 已修 | `P4/index.ts:168` 调 `showWorkerStatus(ctx, workerId, {...})` |
| #3 P2 inner ID ≠ outer ID | ✅ 已修 | **静态实测**：构造 outer ID `worker-abc-1234-xyz`，调 runWorker(team config, ..., outerId)，所有 team 自身 emit workerId=outer ID，所有 child emit parentWorkerId=outer ID |
| #4 dteamTool 动态 import | ✅ 已修 | grep 过滤注释后：真实动态 import 残留 = 0；`dteamTool.ts:17` 静态 import |
| #5 dispose 不清 interval | ✅ 已修 | dispose 实现：clearTick + activeTui=null / clearInterval + =null；**多次 dispose 实测** 不抛错，timer 置 null 后幂等 |

#### 维度 3: 新 bug 引入检查

| 检查项 | 状态 |
|---|---|
| 类型错误（`as any` 滥用） | MINOR - `P4/index.ts:174` cast state 对象是历史遗留，可消除但不影响运行时 |
| 改签名漏改调用方 | ✅ 无 - grep 全代码 `showWorkerStatus(` 调用方都传了 workerId |
| `clearTick` / `clearInterval` 定义 | ✅ 正确 - `worker-widget.ts:476-481` clearTick；dispose 内 inline clearInterval 写法 OK |
| `parentWorkerId ?? innerId` 边界 | ✅ 正确 - 未传时 fallback 到 `solo-/chain-/team-${ts}`（原行为），传了时用 outer（修复行为） |
| 多次 dispose 安全性 | ✅ 实测 3 次连续 dispose 不抛错，timer 置 null 后幂等 |
| 内存泄漏 | ✅ 无 - dispose 真正清 interval |
| 回归测试 | ✅ 19 文件 / 258 测试全过，0 失败 |

#### 维度 4: 代码质量

- ✅ 函数粒度 ≤ 50 行（executeChainSteps ~50 行边界，可接受）
- ✅ 命名清晰：`parentWorkerId` / `workerId` / `innerId` 三者区分明确
- ✅ P2/P3/P4 分层合规：P3 → P2 向下调用符合 P0→P1→P2→P3→P4 依赖关系
- ⚠️ `as any` 用法：`P4/index.ts:174`（state cast）和 `P4/index.ts:298`（installSignalBridge 类型）共 2 处，建议后续用更精确的类型断言替代
- ✅ 注释充分：每个关键修复点都有"关键修复"标识 + 解释为什么

#### 维度 5: 测试覆盖增强

- ✅ 新增 3 个 multi-worker 用例（>DoD 要求 +1）：
  1. `showWorkerStatus 传不同 workerId → store 中 2 条独立记录（不合并到 unknown）`（核心 AC3 场景）
  2. `runTeam 传 parentWorkerId → bus emit 用 outer ID，不嵌套 inner team-${ts}`
  3. `runSolo 传 parentWorkerId → emit workerId = parentWorkerId（替换 inner solo-${ts}）`
- ✅ mock 必要依赖（bus.on / executor 闭包 / signalBridgeUnsubs）
- ⚠️ MINOR - 缺 dispose 验证测试：现有 dispose 测试只验证 disposedCount 计数，没验证 `tickTimer` / `fullscreenRefreshTimer` 真的被清。功能已实现但缺显式测试覆盖。

#### 验收结论

- **通过数**: 13/13 AC 全部 PASS
- **问题清单**: 0 BLOCKER / 0 FAIL / 3 MINOR
  1. MINOR - `P4/index.ts:174` 的 `as any` 可消除（不影响正确性）
  2. MINOR - `P4/index.ts:298` 的 `as any` 可消除（installSignalBridge 类型不严格匹配）
  3. MINOR - `worker-widget.test.ts` 缺 dispose interval 清理的显式测试（功能已实现，建议补充）
- **遗留 / 未覆盖**: AC10 性能（5 worker × 5min）仍需手动验证（来自 build agent 记录）
- **总体评估**: ✅ **READY TO CLOSE**

### 收口记录

#### 经验教训
1. **state 主键不外传**：让 `state` 对象充当 workerId 的"携带者"是反模式（Bug #1 根因），主键应该作为显式参数传递，避免类型欺骗
2. **多层包装时 ID 一致性**：outer worker 和 inner solo/chain/team 的 ID 必须透传（`parentWorkerId`），否则 wrapWorker 清状态时 inner 残留
3. **动态 import 陷阱**：动态 `import().then(...)` 是异步的，事件触发比 import 完成早就会丢事件；能用静态 import 就用静态 import
4. **dispose 需清理所有资源**：不只是计数增加，`setInterval` / `setTimeout` 必须显式 clear，否则旧 widget 被新 widget 替换时 timer 泄漏
5. **check → build → check 闭环**：check agent 发现的 bug 要在下一个 build agent 中修复，然后再次 check 验证，形成完整闭环

#### 踩坑记录
1. **改签名漏改调用方**：`showWorkerStatus` 签名变了，P4/index.ts 和 14 个 widget 测试都要同步更新，不能只改定义
2. **链式调用透传**：`chain → solo/team` 也要透传 `parentWorkerId`，不能只在 P3 透传
3. **`as any` 滥用**：`P4/index.ts` 用了 2 处 `as any`，是历史遗留，建议后续用更精确的类型

#### 归档信息
- **变更文件**：
  - `src/P4/worker-widget.ts`（showWorkerStatus 签名 + dispose 清理）
  - `src/P4/index.ts`（调 showWorkerStatus 传 workerId）
  - `src/P2/solo.ts` / `chain.ts` / `team.ts`（加 parentWorkerId 形参）
  - `src/P3/worker.ts`（runWorker 透传 parentWorkerId）
  - `src/P2/worker.ts`（executeInBackground 传 outer workerId）
  - `src/P4/dteamTool.ts`（静态 import）
  - `tests/P4/worker-widget.test.ts`（同步更新签名）
  - `tests/integration/multi-worker.test.ts`（新增 3 个用例）
- **验收结果**：13/13 AC PASS + 5/5 bug 修复确认
- **遗留 MINOR**：3 个 MINOR 问题（2 个 `as any` 可消除，1 个 dispose 缺显式测试）
- **未提交**：需检查 git 状态

#### 后续可优化
1. 消除 `P4/index.ts:174, 298` 的 `as any`
2. 补充 dispose interval 清理的显式测试
3. AC10 性能（5 worker × 5min）手动验证

