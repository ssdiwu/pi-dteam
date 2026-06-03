# 修复 dteam worker 无效/断点并补全 LLM+调度+自动编排集成

## 基本信息- ID: 20260602170213-eb0m
- 类型: infra
- 创建时间: 2026-06-02T09:02:13.518Z
- 状态: Done

## 目标
- 为什么: 当前 dteam worker 出现"启动即失败、无有效上下文留存"的空转现象，疑似调度/LLM/自动编排链路回归或集成断点；需要系统诊断、修复并补齐实现与文档，避免继续无效循环。
- 做什么: 1) 定位 worker 无效运行的根因并给出可验证修复；2) 校验并补齐 worker→LLM 调度入口→自动编排(task→chain plan)全链路实现；3) 增加回归测试与关键文档同步，确保后续不再空转。

## 范围- 包含:
  - 诊断 worker 启动失败、上下文未持久化、空转问题
  - 复核 worker_create / worker_start / worker_status / memory 等链路实现与调用契约
  - 复核 LLM 调度入口(dteam 工具)与自动编排(task→chain plan)集成点
  - 补齐必要测试与文档同步(README/模块说明)
- 排除:
  - 重构 dteam 整体架构
  - 扩展新功能特性(如新增角色、新增编排模式)
  - 重写无关模块

## 验收条件（GWT + 测试）- [ ] AC1 诊断输出: 能复现/定位 worker 空转的根因，记录现象、证据与修复策略
- [ ] AC2 链路完整: worker_create/worker_start/worker_status/memory 调用链路符合设计契约，关键异常可观测
- [ ] AC3 集成校验: dteam 调度入口与自动编排(task→chain plan)能正确衔接，不产生无上下文的空任务
- [ ] AC4 回归防护: 新增/补全必要测试，`npm test` 通过
- [ ] AC5 文档同步: 变更涉及的 README/模块说明更新，保持实现与文档一致

## 阶段记录### 探索发现
- 当前观察到的直接现象：调 worker_start 后状态迅速变为 failed，但未产出任何可回溯的共享内存键，说明失败点早于或绕过了关键上下文写入链路，而不是"运行后丢结果"。
- 代码层已具备的核心通路仍在：worker_create → worker_start → (executor 或 spawnAgent) → runWorker → 契约回调(onProgress/onComplete)（见 `src/P2/worker.ts`, `src/P3/worker.ts`, `src/P4/index.ts`, `src/P4/dteamTool.ts`）。
- 项目回归测试仍全绿：`npm test` 输出 19 文件 / 258 测试通过，说明"纯逻辑契约"未全面塌方，更像是运行时入口/参数链路或环境模型解析存在断点。
- 高风险点聚焦在三类：1) worker 启动阶段参数缺省（如 workerId/role/model/sessionModel）导致 fail fast；2) 上下文构建阶段读 `.dteam/task/*` 匹配失败但未沉淀足够诊断信息；3) 失败路径吞错或仅回调终态，未把关键错误写入共享内存。
- 已有历史修复记录显示曾出现类似坑：`model` 注入缺失导致 spawn 持续报"缺少 model 和 sessionModel"（见归档：`修复-worker_create-的-model-注入逻辑-20260602135829-gqpz.md`），提示需优先复核 wrapWorker 的 role/model fallback 与 dconfig 读取是否再次失效。
- 设计层面关键假设需校验：当前"LLM 调度入口 + 自动编排(task→chain plan)"是否对 worker 创建参数、任务描述和验收条件抽取形成了稳定契约；如果契约薄弱，主 LLM 极易组装出"有效 plan 但无效 worker config"的空转。

### 讨论决策
- 已收敛为“先补齐最小可观测与契约防护，再扩展更复杂实现”的策略，并拆分出专门实施任务 `20260602171007-ah4v` 执行。
- 决策优先级：失败可观测 > 参数校验 > 调度/编排契约收紧 > 全链路扩展实现。

### 执行记录（阶段性）
- 已完成阶段性诊断并输出设计/实施方案：新建设计任务 `20260602170625-tc2t`（已归档）与实施任务 `20260602171007-ah4v`（InProgress）。
- 已在 `src/P2/worker.ts` 增加 `worker-<id>` 共享内存诊断键写入，解决“失败无上下文”核心问题。
- 已在 `src/P3/chainPlanner.ts` 收紧空目标校验，避免生成空 step。
- 已新增并运行测试：`tests/integration/worker-memory-diagnostic.test.ts` + `tests/P3/chainPlanner.test.ts`。
- 当前回归状态：`npm test` 20 文件 / 260 测试通过。

### 收口记录
（待补：在实施任务完成后，统一回填最终结论与未闭环风险）

