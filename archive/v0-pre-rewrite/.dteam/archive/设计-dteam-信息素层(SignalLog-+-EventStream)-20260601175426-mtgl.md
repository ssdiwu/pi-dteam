# 设计 dteam 信息素层（SignalLog + EventStream）

## 基本信息
- ID: 20260601175426-mtgl
- 类型: refactor
- 创建时间: 2026-06-01T09:54:26.960Z
- 状态: todo

## 目标
- 为什么: dteam 当前 SignalBus 仅在内存（src/P1/signalBus.ts history: Signal[]），background worker 派生的子进程互相看不到信号；task Markdown 不适合承载高频低价值的进度/警告/发现事件流。需要一个文件级追加日志 + 桥接层，让团队协作可追溯、可审计、可跨进程读。
- 做什么: 为 dteam 设计一个属于 dteam 的「信息素层」：P0 类型层 SignalEvent + P1 服务层 SignalLog（追加日志）+ P2 桥接层 EventStream（SignalBus↔SignalLog）。复用 dteam 4 信号类型和 P0 原子层，与 task 体系协同，方案落入 task「阶段记录→讨论决策」section 供 build agent 实施。

## 范围## 范围

### 包含

- **P0/signalEvent.ts**：信号事件类型 + TTL 计算工具（纯类型/纯函数，零依赖）
- **P1/signalLog.ts**：追加日志服务（append / recent / rotate / tail），POSIX O_APPEND 原子追加，TTL 软过期，>10k 条自动滚动
- **P2/eventStream.ts**：SignalBus ↔ SignalLog 桥接器（订阅 bus.on() 自动落盘、view() 合并内存+文件、seal() 收口归档）
- **接入点设计**：worker_start 何时开 EventStream、worker_cancel 何时 seal、/close 收口时如何从 SignalLog 提炼关键事件进 task 阶段记录
- **目录结构**：.dteam/signal/<run-id>.jsonl + .dteam/signal/archive/<run-id>.<seq>.jsonl
- **5 个 milestone 拆分**：M1(M0+类型) / M2(P1 服务) / M3(P2 桥接) / M4(worker_start/cancel 接入) / M5(widget 增强—本 task 仅出设计)
- **兼容性分析**：对 v0.4.x 现有 API（worker_create / worker_start / worker_sendSignal / memory_*）的影响评估

### 排除

- TUI widget 实际改造代码（M5 是独立实施任务，本 task 只出设计）
- worktree 隔离（独立 task，已在上一轮讨论识别）
- dteam 调度入口（独立 task，上一轮讨论 #1）
- 自动编排 chain plan（独立 task，上一轮讨论 #2）
- 自适应并发（独立 task，上一轮讨论 #5）
- 新增信号类型（如 warning）— 保持 v0.4.x 类型稳定，4 种信号不增不减
- worker_start 实际代码改造（只设计接入点，不在本 task 实施）

## 验收条件（GWT + 测试）## 验收条件（GWT）

- [ ] AC1 · 类型层（见下方描述）
- [ ] AC2 · 服务层
- [ ] AC3 · 桥接层
- [ ] AC4 · 协作边界
- [ ] AC5 · 演进路线
- [x] AC6 · 文档落地

### AC1 · 类型层

- **G** dteam 已有 P0/signal.ts 定义 4 种 SignalType（progress / blocked / found / help）
- **W** 设计 P0/signalEvent.ts 的 SignalEvent 类型
- **T** SignalEvent 包含 id/type/src/ts/ttl/expiresAt/taskId/data/refs/severity/artifacts 字段；JSDoc 完整；TTL 计算函数 pure；不依赖任何 P1+ 模块

### AC2 · 服务层

- **G** dteam 已有 P0/atomic.ts + P0/pathSafety.ts
- **W** 设计 P1/signalLog.ts 的 SignalLog 类
- **T** 提供 append / recent / rotate / tail 4 个方法；append 用 POSIX O_APPEND 原子追加；recent 支持 type/src/taskId/limit/since 过滤；TTL 在读取时软过滤；单文件 >10k 条触发 rotate；路径在 .dteam/signal/ 下且走 pathSafety 校验

### AC3 · 桥接层

- **G** dteam 已有 P1/signalBus.ts（emit/on/getHistory），dteam 4 信号已注册
- **W** 设计 P2/eventStream.ts 的 EventStream 类
- **T** start() 订阅 bus 4 种类型自动 append；view() 合并 bus history + log recent 去重；seal() 归档到 .dteam/signal/archive/；不破坏 SignalBus 现有 API 签名

### AC4 · 协作边界

- **G** dteam 已有 worker_start/worker_cancel 工具，task 阶段记录支持 task_update
- **W** 设计 SignalLog 与 worker/task 的接入点
- **T** 明确：worker_start 前/后开 EventStream 的时机；worker_cancel 时 seal 的策略；/close 时从 SignalLog 提炼关键事件进 task 阶段记录的策略（不污染 task、提炼而非全文抄）；与 task_update 的写入路径不冲突

### AC5 · 演进路线

- **G** v0.4.x 已有稳定 API：worker_create / worker_start / worker_sendSignal / memory_* / signal_*
- **W** 设计 5 个 milestone + 兼容性矩阵
- **T** M1-M3 0 破坏（仅新增文件）；M4 行为增强向后兼容；M5 仅设计不实施；新增 API 全部在 P1 模块下；不修改 P0/signal.ts 已有 SignalType 枚举

### AC6 · 文档落地

- **G** 设计完成后
- **W** 写入 task「阶段记录→讨论决策」section
- **T** 内容包含：最终方案 / 技术选型理由 / 权衡取舍 / 实施步骤 4 个部分；自动作为 build agent 的执行依据

## 阶段记录### 探索发现

#### 1. Blocker 确认：worker_create 参数序列化 bug

**问题现象**：
- 4 次不同写法的 worker_create + worker_start 都报 `config.options?.find is not a function`
- 从 worker_getMemory 拿到的实际 config 显示 `options: {item:[{type:role,value:design}]}`（应该是数组）

**根因分析**：
- **P4/index.ts:432** 的 parameters 声明：`config: { type: "object", description: "WorkerConfig 配置" }`
- 没有定义 options 内部结构（应该是 `options: { type: "array", items: { ... } }`）
- MCP/Pi 工具的 JSON 序列化层在处理未定义内部结构的 object 时，把数组错误地转成了对象
- 具体表现：`options: [...]` → `options: {item: [...]}`

**影响范围**：
- dteam 的 5 个 worker 工具（create/start/signal/cancel/status）全部受影响
- solo/team/chain 三种模式都跑不起来
- 这是一个 P0 级别的阻塞性 bug

#### 2. 外部调研：已知的 MCP 工具参数序列化问题

**GitHub Issues 确认**：
- anthropics/claude-code#22394：MCP tools: Array parameters serialized as strings instead of arrays
- anthropics/claude-code#18260：MCP tool parameters with $ref schemas are incorrectly serialized as strings
- notion-mcp-server#176：Bug: MCP Tool Parameter Serialization Issue - Nested Objects

**问题本质**：
- MCP 工具的 JSON Schema 定义不完整时，序列化层会错误推断类型
- 数组被转成对象，对象被转成字符串
- 这是 MCP 工具生态的普遍问题，不是 dteam 独有的

#### 3. 解决方案方向

**短期修复（P4 层）**：
- 在 P4/index.ts 的 parameters 中正确定义 options 的内部结构
- 使用 JSON Schema 的 `items` 关键字定义数组元素类型
- 或者使用 `oneOf` 定义联合类型

**长期方案**：
- 在 P3 层添加参数验证和转换逻辑
- 考虑使用 Zod 或类似库做运行时类型检查
- 在 workerCreate 等函数入口处添加防御性代码

**临时绕过**：
- 用户提到的「以 design agent 身份直接产出方案」是合理的临时方案
- 不依赖 dteam worker 调度，直接执行设计任务

#### 4. 信息素层设计的上下文

**当前任务状态**：
- 任务「设计 dteam 信息素层」处于 todo 状态
- blocker 不影响信息素层的设计工作（设计本身不依赖 worker 调度）
- 但 blocker 会影响信息素层的实现和测试

**建议优先级**：
1. **P0**：修复 worker_create 参数序列化 bug（build agent 第一优先级）
2. **P1**：继续信息素层设计（design agent 可以并行进行）
3. **P2**：信息素层实现（依赖 P0 修复）

### 讨论决策

> **设计 agent 说明**：本节由 design agent 直接产出（不依赖 dteam 的 worker 调度，因为 P0 工具链 bug 见探索发现 #1）。本节内容供后续 build agent 实施依据。

#### 最终方案

**核心思想**：基于 dteam 现有 SignalBus 抽象，新增一个**文件级追加日志 + 桥接器**，让信号事件从"内存快路径"扩展为"内存+文件双层"。**不替换 SignalBus**（保留进程内低延迟通信），**不污染 task**（task 是契约/产物）。

##### 三层结构（dteam 化命名）

```
P0/signalEvent.ts     ← 纯类型 + TTL 工具（零依赖）
P1/signalLog.ts       ← 追加日志服务（依赖 fs + P0/atomic + P0/pathSafety）
P2/eventStream.ts     ← SignalBus ↔ SignalLog 桥接（依赖 P1 + P1/signalBus）
```

- **不叫 `pheromone`**（any 的隐喻，dteam 不用）
- **核心命名**：`SignalEvent`（事件）/ `SignalLog`（文件日志）/ `EventStream`（桥接器）

##### 完整类型定义

```typescript
// P0/signalEvent.ts
import type { SignalType } from "./signal.js";

/**
 * 信号事件：dteam 信息素层的原子数据单元。
 * 复用 dteam 4 种 SignalType，可选带 taskId 关联和 ttl 衰减。
 */
export interface SignalEvent {
  /** 唯一 ID：复用 signal-<ts>-<rand> 格式 */
  id: string;
  /** 信号类型（4 种） */
  type: SignalType;
  /** 发出方 workerId */
  src: string;
  /** 毫秒时间戳 */
  ts: number;
  /** 关联 task id（关键：让事件可追溯到 task） */
  taskId?: string;
  /** TTL 毫秒；不设则永不过期 */
  ttl?: number;
  /** 计算字段：ts + ttl；为 0/undefined 视为永不过期 */
  expiresAt?: number;
  /** 事件负载 */
  data?: Record<string, unknown>;
  /** 依赖引用（文件路径 / 任务 id / worker id） */
  refs?: string[];
  /** 严重度（blocked 类事件用） */
  severity?: "low" | "med" | "high";
  /** 产出文件路径（progress/done 用） */
  artifacts?: string[];
}

/** 计算 expiresAt（pure） */
export function computeExpiresAt(event: Omit<SignalEvent, "expiresAt">): number | undefined {
  if (event.ttl === undefined) return undefined;
  return event.ts + event.ttl;
}

/** 判断是否过期（pure） */
export function isExpired(event: SignalEvent, now: number = Date.now()): boolean {
  if (event.expiresAt === undefined) return false;
  return now >= event.expiresAt;
}
```

##### 完整 API 签名

```typescript
// P1/signalLog.ts
export interface SignalLogOptions {
  cwd: string;
  runId: string;                       // 一次 dteam 编排 run 的 id
  maxLinesPerFile?: number;            // 默认 10000
  signalDir?: string;                  // 默认 ".dteam/signal"
}

export interface RecentQuery {
  type?: SignalType;
  src?: string;
  taskId?: string;
  since?: number;                      // ts 毫秒
  limit?: number;                      // 默认 100
  includeExpired?: boolean;            // 默认 false
}

export class SignalLog {
  constructor(opts: SignalLogOptions);
  readonly path: string;               // .dteam/signal/<run-id>.jsonl
  readonly archiveDir: string;         // .dteam/signal/archive

  /** 追加一条事件（POSIX O_APPEND 原子追加） */
  append(event: Omit<SignalEvent, "id" | "expiresAt">): Promise<SignalEvent>;

  /** 读最近 N 条，可按 type/src/taskId/since 过滤；TTL 软过滤 */
  recent(query?: RecentQuery): Promise<SignalEvent[]>;

  /** 物理滚动（> maxLinesPerFile 触发） */
  rotate(): Promise<{ archivedTo: string; lineCount: number }>;

  /** 读全部（调试用，分页返回） */
  tail(maxLines?: number): Promise<SignalEvent[]>;

  /** 物理归档（/close 收口时调） */
  seal(): Promise<{ sealedTo: string; count: number }>;

  /** 物理删除过期（可选，默认不调） */
  pruneExpired(now?: number): Promise<number>;
}
```

```typescript
// P2/eventStream.ts
export class EventStream {
  constructor(bus: SignalBus, log: SignalLog);

  /** 启动：订阅 bus 4 类型事件，自动 append 到 log */
  start(): void;

  /** 停止：取消所有订阅 */
  stop(): void;

  /** 给 worker 的"我看得到什么"视图（合并 bus history + log recent 去重） */
  view(query?: RecentQuery): Promise<SignalEvent[]>;

  /** 收口：归档当前 run 的所有事件 */
  seal(): Promise<{ sealedTo: string; count: number }>;

  /** 当前是否在订阅中 */
  readonly active: boolean;
}
```

##### 关键代码片段

**a) POSIX 原子追加（`P1/signalLog.ts`）**

```typescript
import { open } from "node:fs/promises";

async function appendLine(filepath: string, line: string): Promise<void> {
  // O_APPEND 保证多进程下 write 不交错；POSIX 要求 write < PIPE_BUF
  // 一次 append 一行（JSON.stringify + '\n'）通常 < 4KB，远小于 PIPE_BUF
  const handle = await open(filepath, "a");  // 'a' = O_WRONLY|O_CREAT|O_APPEND
  try {
    await handle.write(line + "\n");
  } finally {
    await handle.close();
  }
}
```

**b) TTL 软过滤（`P1/signalLog.ts`）**

```typescript
async recent(query: RecentQuery = {}): Promise<SignalEvent[]> {
  const lines = await this.tail(1000);  // 先读最近 1k 行
  const now = Date.now();
  const filtered = lines.filter(e => {
    if (!query.includeExpired && isExpired(e, now)) return false;
    if (query.type && e.type !== query.type) return false;
    if (query.src && e.src !== query.src) return false;
    if (query.taskId && e.taskId !== query.taskId) return false;
    if (query.since && e.ts < query.since) return false;
    return true;
  });
  return filtered.slice(-(query.limit ?? 100));
}
```

**c) 文件滚动（`P1/signalLog.ts`）**

```typescript
async rotate(): Promise<{ archivedTo: string; lineCount: number }> {
  const lines = await this.tail();
  if (lines.length < (this.maxLinesPerFile)) {
    return { archivedTo: "", lineCount: 0 };
  }
  const seq = (await this.nextSeq());
  const archivedTo = join(this.archiveDir, `${this.runId}.${seq}.jsonl`);
  await mkdir(this.archiveDir, { recursive: true });
  await rename(this.path, archivedTo);
  // 下次 append 时会重新创建
  return { archivedTo, lineCount: lines.length };
}
```

**d) EventStream 桥接（`P2/eventStream.ts`）**

```typescript
start(): void {
  if (this.active) return;
  this.unsubscribers = [
    this.bus.on("progress", sig => this.handle(sig)),
    this.bus.on("blocked",  sig => this.handle(sig)),
    this.bus.on("found",    sig => this.handle(sig)),
    this.bus.on("help",     sig => this.handle(sig)),
  ];
}

private async handle(sig: Signal): Promise<void> {
  const event: SignalEvent = {
    id: sig.id,
    type: sig.type,
    src: sig.workerId,
    ts: sig.timestamp,
    data: sig.data as Record<string, unknown>,
  };
  await this.log.append(event);
}

async view(query?: RecentQuery): Promise<SignalEvent[]> {
  // 合并内存 history 和文件 recent，按 id 去重
  const inMemory: SignalEvent[] = this.bus
    .getHistory()
    .map(s => ({ id: s.id, type: s.type, src: s.workerId, ts: s.timestamp, data: s.data as Record<string, unknown> }));
  const fromFile = await this.log.recent({ ...query, limit: query?.limit ?? 100 });
  const seen = new Set<string>();
  const merged: SignalEvent[] = [];
  for (const e of [...fromFile, ...inMemory]) {
    if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); }
  }
  return merged.sort((a, b) => a.ts - b.ts).slice(-(query?.limit ?? 100));
}
```

##### 与现有组件的协作边界

| 触发点 | 行为 |
|--------|------|
| `worker_start`（solo 模式） | 启动 EventStream.start()，传入 runId = `worker-${ts}-${rand}` |
| `worker_start`（team/chain 模式） | 父 worker 启动时创建 SignalLog，子 worker 通过 taskId 关联到同一 run |
| `worker_cancel` | 调 EventStream.seal()，归档到 `.dteam/signal/archive/<run-id>.jsonl` |
| `worker_status` | 调 EventStream.view({src: workerId, limit: 5})，widget 显示最近事件 |
| `/close` 收口 | 调 `task_update` 写"阶段记录→收口记录"section，**从 SignalLog.recent() 提炼**关键事件（如：blocked 列表、completion 摘要），不全文抄 |
| 跨进程 worker | 新进程启动时 `SignalLog.recent({since: parentStartTime})` 回放 |

**关键不冲突点**：
- `task_update` 写 task Markdown 阶段记录
- `SignalLog.append` 写 `.dteam/signal/<run-id>.jsonl`
- **两者写入路径不同**，互不干扰

#### 技术选型理由

| 决策 | 选什么 | 理由 |
|------|--------|------|
| 存储格式 | JSONL（每行一个 JSON） | append-only 友好、行级原子、易 grep 调试 |
| 原子追加 | POSIX O_APPEND | 不锁；4KB 内一次 write 原子；Node `open(path, "a")` 封装 |
| TTL 软过期 | 读取时过滤 | 不物理删，jsonl 累积可审计；写入 O(1)，读取 O(N) 但 N 受限 |
| 文件滚动 | rename 到 archive/ | 不复制、不重写，O(1) |
| 桥接策略 | 订阅 bus.on() 自动落盘 | 非侵入；SignalBus 现有 API 不动 |
| 跨进程读 | 文件系统 | any 验证过；Node `fs/promises` 跨平台 |
| 命名 | SignalLog / EventStream | 复用 dteam 现有 signal 抽象；不照搬 any 的 pheromone 隐喻 |
| 不引入新依赖 | 0 npm 依赖 | 复用 `node:fs/promises` + `P0/atomic.ts` + `P0/pathSafety.ts` |

#### 权衡取舍

| 维度 | 选了什么 | 放弃的方案 | 为什么 |
|------|---------|-----------|--------|
| 信号类型 | dteam 4 种 | any 5 种（含 warning/completion/dependency） | 保持 v0.4.x 类型稳定；warning 用 blocked+severity 表达；completion 用 progress+data.status 表达；dependency 用 found+refs 表达 |
| 物理过期 | 不物理删 | 定期 prune | 软过期简单可审计；jsonl 累积在 archive 目录可清理 |
| 内存合并 | bus history + log recent 去重 | 全部走 log | 内存快路径保持不变；冷启动/跨进程才走文件 |
| 与 task 关系 | /close 时提炼 | 实时同步 | task 是契约不是日志；提炼是合理边界 |
| 是否引入 intercom-like | 否 | 加 contact_supervisor 通道 | dteam 有自己的 4 信号 + 5 策略，不重复造轮子 |
| 并发写入 | POSIX O_APPEND（不锁） | 文件锁 | JSONL 行级原子足够；any 也用 O_APPEND 不锁 |

#### 实施步骤（5 个 milestone + 1 个 P0 修复）

> **关键前置**（优先级 0，先修）：dteam worker 工具链的 `config.options` 数组序列化 bug（见探索发现 #1）。不修这个，build agent 跑不通验证。

| M | 范围 | 交付物 | 行数估算 | 兼容性 |
|---|------|--------|---------|--------|
| **P0-fix** | 修 `P4/index.ts` 的 `worker_create` schema | 严格定义 `config.options: { type: "array" }` + e2e 测试 | +20 -10 | 修 bug，无破坏 |
| **M1** | 新建 `P0/signalEvent.ts` | `SignalEvent` 类型 + `computeExpiresAt` + `isExpired` + 单测 | 60 + 80（测） | 0 破坏（仅新增） |
| **M2** | 新建 `P1/signalLog.ts` | `SignalLog` 4 方法（append/recent/rotate/tail/seal）+ 单测 + 集成测试（多进程追加） | 200 + 150（测） | 0 破坏（仅新增） |
| **M3** | 新建 `P2/eventStream.ts` | `EventStream` 类 + start/stop/view/seal + 桥接测试 | 120 + 100（测） | 0 破坏（仅新增） |
| **M4** | `P2/worker.ts` 改造 | `worker_start` 自动开 EventStream；`worker_cancel` 调 seal；`worker_status` 接入 view() | +40 -5 | 行为增强，向后兼容 |
| **M5** | `P4/worker-widget.ts` 增强 | widget 显示最近 N 条事件；可折叠展开 | +60 | 可视化增强，opt-in |

**总计**：~700 行（含测试），5 个 PR 串行可独立合入。

#### 风险清单

| 风险 | 等级 | 应对 |
|------|------|------|
| **R1**: POSIX O_APPEND 在 Windows 下不保证原子追加（Windows 用 O_APPEND 实现不同） | 中 | dteam 现有 `P0/atomic.ts` 已经在做跨平台兼容；M2 复用它，不重新实现 |
| **R2**: 大 jsonl 文件读取性能（recent() 每次读 1k 行反序列化） | 低 | 加 `tail(1000)` 上限；后续如需要可加轻量索引（按日切片） |
| **R3**: view() 合并去重 O(N) 每次扫全集 | 低 | id 是 hash + ts，本身很快；N 受 limit 限制 |
| **R4**: EventStream 订阅未清理导致内存泄漏 | 中 | M3 测试用 mock bus 验证 start/stop 对称；start() 二次调用返回；stop() 幂等 |
| **R5**: `/close` 提炼时错误地把高频进度事件全量写入 task | 中 | M4 限制：只提炼 type∈{blocked, found} 且 severity∈{med,high} 的事件；progress 默认不入 task |
| **R6**: worker 工具链 bug 没修之前，build agent 无法用 dteam 流程验证 | 高 | **P0-fix 必须在 M1 之前**；否则 build agent 要走手动 ts-node 跑测试 |
| **R7**: SignalLog 和 task_update 都用 fs 写，路径不同但权限可能冲突 | 低 | 都走 `P0/pathSafety` 校验；目录隔离（`signal/` vs `task/`） |
| **R8**: 跨平台路径分隔符（Windows 用 `\`） | 低 | 全部用 `node:path` 的 `join`；测试覆盖 Windows 路径 |

#### 兼容性矩阵

| API | M1 影响 | M2 影响 | M3 影响 | M4 影响 | M5 影响 |
|-----|---------|---------|---------|---------|---------|
| `worker_create` | 0 | 0 | 0 | 0 | 0 |
| `worker_start` | 0 | 0 | 0 | +EventStream 启动（行为增强） | 0 |
| `worker_cancel` | 0 | 0 | 0 | +seal() 副作用 | 0 |
| `worker_status` | 0 | 0 | 0 | +view() 输出 | +widget |
| `worker_sendSignal` | 0 | 0 | 0（事件自然落盘） | 0 | 0 |
| `memory_*` | 0 | 0 | 0 | 0 | 0 |
| `task_*` | 0 | 0 | 0 | 0（/close 提炼是 opt-in） | 0 |
| `signal_*` | 0 | 0 | 0 | 0 | 0 |

**总结**：M1-M3 严格 0 破坏；M4 行为增强但默认开启；M5 可视化 opt-in。任何 v0.4.x 用户升级到 v0.5.0 都不需要改代码。


### 执行记录
（待填写）

### 收口记录
（待填写）

