# dteam-worker-状态-Widget-TUI

## 基本信息
- ID: 20260601140306-z8oy
- 类型: ui
- 创建时间: 2026-06-01T06:03:06.605Z
- 状态: Done

## 目标
- 为什么: dteam 的 worker 执行时没有任何实时状态反馈，用户不知道 worker 在干什么、跑了多久、用了多少 tools。需要借鉴 pi-tldr 的 bordered box widget，在 TUI 中显示 worker 实时状态。
- 做什么: 实现 Worker 状态 Widget：1)用 ctx.ui.setWidget() 注册 bordered box widget；2)从 spawnAgent 的 session.subscribe 事件提取 tool calls 更新状态；3)显示 agent/task/tools/elapsed 信息；4)节流更新避免 flicker。

## 范围
- 包含:
  - 新增 `src/P4/worker-widget.ts` — WorkerStatusBox Component + showWorkerStatus/clearWorkerStatus 函数
  - 改造 `src/P1/spawn.ts` — 在 spawnAgent 中集成 widget 更新（session.subscribe 事件驱动）
  - 改造 `src/P2/worker.ts` — 在 workerStart 中集成 widget 更新（executor 调用前后）
  - 单测 `tests/P4/worker-widget.test.ts` — mock ctx.ui.setWidget 验证调用
  - 同步更新 `src/P4/README.md`
- 排除:
  - 不改 pi-tldr 代码（只借鉴设计模式）
  - 不实现 TLDR 模型调用（纯本地状态显示）
  - 不实现多 worker 并发 widget（先做单 worker）
  - 不改 worker 工具 API（纯 UI 增量）

## 验收条件（GWT + 测试）
- [x] **Given** worker_start 调用 spawnAgent,
      **When** spawnAgent 执行期间,
      **Then** TUI 显示 bordered box widget（╭ worker ── 🔄 running ─╮），包含 agent/task/tools/elapsed 信息
- [x] **Given** session.subscribe 收到 tool_execution_start 事件,
      **When** widget 更新,
      **Then** currentTool 字段显示当前 tool name，toolCount 递增
- [x] **Given** session.subscribe 收到 tool_execution_end 事件,
      **When** widget 更新,
      **Then** currentTool 字段清空
- [x] **Given** 连续多次事件触发,
      **When** 间隔 < 1s,
      **Then** widget 只更新一次（节流，避免 flicker）
- [x] **Given** spawnAgent 执行完成（成功或失败）,
      **When** 清除 widget,
      **Then** TUI 不再显示 worker 状态 box
- [x] **Given** npm test 运行,
      **When** 测试套件执行,
      **Then** 全部通过，无真 API key 依赖

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
