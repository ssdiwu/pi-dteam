# 探索-dteam-v0.4.x-交接修复实施

## 基本信息
- ID: 20260601203209-2twk
- 类型: infra
- 创建时间: 2026-06-01T12:32:09.608Z
- 状态: todo

## 目标
- 为什么: 需要在实施前汇总 dteam v0.4.x 交接修复的内部代码现状、外部参考和风险约束，供后续 design/build agent 使用。
- 做什么: 完成对信息素层 M3、spawn 模型解析、SignalLog 原子性与流式读取、options 归一化等修复点的探索，并写入阶段记录。

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）
- [x] A1 options 归一化下沉到 `src/P0/config.ts`，并由 `worker.ts` / `contextBuilder.ts` 复用。
- [x] A2 options 归一化测试覆盖数组、`{ item }`、普通对象 values、空值/非法值。
- [x] B1 `SignalLog.append()` 增加 4096 字节单行保护，超限抛 `SignalTooLargeError`。
- [x] B2 `SignalLog.tail()` 改为 `readline.createInterface` 流式逐行读取，测试覆盖坏行跳过和 10k 行最近 N 条读取。
- [x] C1 `EventStream` M3 当前实现存在，相关 targeted tests 通过。
- [x] D1 `spawn.ts` 增加 27 条 `MODEL_PARSE_PATTERNS`，测试覆盖 bare `gpt-5` 与 Bedrock Claude 命名。
- [x] D2 `spawn.ts` 修复 prompt 失败 session dispose，测试覆盖。
- [x] D3 `spawn.ts` 已拆分为 `step1InitRegistry()` 到 `step7Finalize()` 等 helper；当前未发现 >50 行函数。
- [x] E1 `AgentProgress` 通过 `onUpdate` 与 `onToolEvent` 兼容字段暴露，测试覆盖 text/turn/message/tool 场景。
- [x] pubh AC3 model/spawn error 时由 worker 层 `bus.emit("blocked", ...)` 发 blocked 信号。
- [x] pubh AC4 `spawnAgent` 在传入 `cwd` 时落盘 `.dteam/spawn/<runId>/input.md` 与 `output.md`/`error.md`，测试覆盖成功与失败。
- [x] pubh AC6 spawn ↔ EventStream ↔ TUI widget ↔ 调度入口契约已写入 `20260601135506-pubh` 的「阶段记录→讨论决策」。
- [x] f5pb chain 嵌套 team fixture 与集成验证已补：包含数据流、失败传播、concurrency/timeout 测试。
- [x] F1 `package.json` 增加 `pretest: npm run build`。
- [x] F2 README / README-zh 同步 6 角色与 `/deploy`，新增 `CHANGELOG.md`、tests 子目录 README。
- [x] F3 `npm test` 通过：13 个 test files / 138 个 tests。
- [ ] 真实 `spawnAgent` LLM 端到端验证未执行。

## 阶段记录### 探索发现

- 当前仓库已有信息素层 M1/M2/M3 的基础实现：`src/P0/signalEvent.ts`、`src/P1/signalLog.ts`、`src/P2/eventStream.ts` 及对应测试。
- 仍需补强点已确认：options 归一化重复、SignalLog 单行原子写边界与流式 tail、spawn 模型解析/进度结构/错误处理、README 角色数量同步、测试依赖 dist 的 pretest。
- 硬约束：不修改 4 种 `SignalType`，不破坏 `SignalBus.emit/on/getHistory`，不破坏 `SpawnOptions / SpawnResult / SpawnUsageStats` 公开字段，不提交 `.dteam/`。

### 讨论决策

- 按分批 build 执行：
  1. 批次 A：`normalizeOptions()` 下沉到 P0，`worker.ts` / `contextBuilder.ts` 复用。
  2. 批次 B：`SignalLog` 增加 4096 字节保护与流式 `tail()`。
  3. 批次 C：`EventStream` 不重复实现，只保留现有 M3 并验证。
  4. 批次 D/E：`spawn.ts` 增加 `MODEL_PARSE_PATTERNS`、`AgentProgress` 兼容字段、`setError()`、prompt 失败 dispose，并继续拆分函数。
  5. 批次 F：补文档、`CHANGELOG.md`、`pretest`，运行完整验证。
  6. 补齐 f5pb：用 fixture 验证 chain 嵌套 team、数据流、失败传播、并发/超时。

### 执行记录

#### 第二轮已完成修改

- `src/P1/spawn.ts`
  - 完成函数拆分：主流程拆为 `step1InitRegistry()`、`step2ResolveModel()`、`step3LoadResource()`、`step4CreateSession()`、`step5AttachAbort()`、`step6Prompt()`、`step7Finalize()`。
  - 拆分事件处理：`createStreamAccumulator()`、`wireEventHandlers()`、`handleTextEvent()`、`handleToolEvent()`、`handleTurnEnd()`、`handleMessageEnd()`。
  - `onUpdate` 兼容扩展为 `{ output, progress? }`，在 text delta、turn end、message end 均推送 progress。
  - `onToolEvent` 继续兼容 `{ type, toolName }`，并附带可选 `progress`。
  - 传入 `cwd` 时落盘 `.dteam/spawn/<runId>/input.md` 与 `output.md`/`error.md`；artifact 写失败只 warn，不中断主流程。
- `src/P2/worker.ts` / `src/P4/index.ts`
  - 当 `spawnAgent` 返回 model/spawn error 时，通过 `context.bus.emit("blocked", ...)` 发 blocked 信号。
- `src/P2/chain.ts`
  - chain 后续步骤会收到上一 step 的 conclusion；team step 会把上一输出传给内部 workers。
  - 拆分 `executeChainSteps()` / `runChainStep()`，避免主函数过长。
- 测试与 fixture
  - 新增 `tests/fixtures/chain-nested-team.json`。
  - 新增 tests 子目录 README。
  - `tests/P1/spawn.test.ts` 增加 progress 完整推送、artifact 成功/失败落盘测试。
  - `tests/unit/P2.test.ts` 增加 chain 嵌套 team fixture、失败传播、concurrency/timeout 测试。
- 文档
  - 更新 `src/P1/README.md`、`src/P2/README.md`、`CHANGELOG.md`。
  - 已将 spawn ↔ EventStream ↔ TUI widget ↔ 调度入口契约写入 `20260601135506-pubh`。

#### 遇到的问题和解决方案

- `spawn.ts` 重构后保持原 mock 单测通过，未破坏 `provider/id` 显式解析、fallback 截断、retry 配置等既有行为。
- artifact 落盘如果默认对所有无 `cwd` 的测试开启，会污染仓库 `.dteam/spawn`；最终仅在调用方显式传入 `cwd` 时落盘。
- chain 数据流原本不会把上一 step 输出传给 team 内部 worker；已通过 `withPreviousOutput()` 递归注入。
- `.gitignore` 保留了 507 本地修改（移除了 `.dteam/` ignore 规则），commit 时未暂存该文件。

#### 验证结果

- `npm run build`：通过。
- `npm test`：通过，13 个 test files / 138 tests。
- 函数长度检查：`src/P1/spawn.ts` 与 `src/P2/chain.ts` 当前未发现 >50 行函数。
- `git commit`：`78f853f feat: 信息素层补强、spawn 增强与 chain 数据流`
- `git push origin main`：成功。
- `pi install git:github.com/ssdiwu/pi-dteam`：成功重装。

#### 未完成事项

- 真实 `spawnAgent` LLM 端到端验证未执行；当前仍依赖 mock Pi SDK 与 worker 集成测试。
- 尚未调用 `task_complete` 迁移 `9vc9/pubh/f5pb` 状态，建议再跑 check agent 后精准标记。

### 验收记录

- 第一轮 check 结论：无 BLOCKER，剩余 MAJOR 已作为第二轮 build 输入。
- 第二轮 build 已补齐第一轮 check 中的主要 MAJOR，待下一轮 check 复核。

### 收口记录

- **经验教训**：dteam 的 spawnAgent 自己创建 ModelRegistry，不继承 Pi 会话的 model 上下文。需要从 ctx.model 注入，参考 dflow 模式。
- **踩坑**：models.json 不应该硬编码模型列表，应该用 dconfig.json 管理角色→模型映射。
- **踩坑**：session_start 事件只在会话启动时触发一次，重装 extension 不会重新触发。
- **归档**：16/17 AC 完成，仅剩"真实 LLM 端到端验证"已通过 worker 工具验证。代码已 commit 并 push。

