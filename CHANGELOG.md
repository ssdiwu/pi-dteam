# Changelog

本文件记录 dteam 的用户可感知变更与关键实现收口。  
格式参考 Keep a Changelog，但保持中文、简洁、面向项目实际。

## [0.5.0] - 2026-06-11

### 新增
- 新增轻量依赖图调度：基于 `PlanStep.files` 生成 `FileGraph`，支持相对 `import`、`export from`、`require`、目录 `index.*` 和 JS/TS 常见扩展。
- 新增 preflight scheduling：`team` 模式在执行前识别 hard conflict、shared file、dependency edge、unknown boundary，并生成可解释 `SchedulingPlan.batches`。
- 新增 `pi.appendEntry()` checkpoint：写入 `dteam-plan` 和 `dteam-scheduling`，不污染 LLM context。
- 新增 `dteam-report.details` 的 plan / fileGraph / scheduling / step task-strategy-files，完成后可回溯计划、批次和冲突原因。
- 新增运行态 compact widget（小组件）任务树：显示 mode、done/total、耗时、running worker 最新输出、delayed reason。
- 新增 `/dteam` 内容型 tabs：`0 概览`、`1 批次`、`2 Workers`、`3 信号`、`4 报告`。

### 变更
- `team` 不再只按固定 batchSize 顺序并行，而是先经过 preflight batches；无冲突仍并行，有明确冲突则自动拆批。
- `solo` / `chain` 只附带 fileGraph / scheduling 信息，不改变 planner 给出的执行顺序。
- 完成态不再立即清空：widget 和 `/dteam` 保留上一轮结果，直到下一次 `dteam(action="run")` 开始。
- done worker 在 widget 中使用删除线 + dim 弱化；running / failed / delayed 使用更清晰的图标和颜色语义。
- `Workers` tab 显示 step files，每个 worker 最多显示 2 行输出，避免 debug panel 式堆叠。
- `SchedulingPlan` 增加 `delayedSteps`，用于解释每个被延后的 step 和原因。

### 不做
- 不做固定 6 阶段流水线。
- 不开放自定义角色系统；继续保留 5 个写死角色。
- 不做文件锁、worktree、自动 merge/rebase。
- 不默认做持久化 / resume（恢复）/ 进程级隔离。
- 不引入 TypeScript compiler API 或 Babel AST；file graph 保持文本扫描。

### 验证
- `npm run build` 通过。
- `npm test` 通过（19 个测试文件，300 个测试）。

## [0.4.2] - 2026-06-11

### 变更
- 文档层重新校准 dteam 定位：Pi 里的轻量多 subagent（子代理）协作引擎；简单任务主 LLM 直接干，复杂任务才调 dteam。
- 路线图将固定流水线降级为“暂不做”，把 UI 可观测性作为 0.5 起点。
- 补充 @juicesharp/rpiv-todo、SwarmFlow、MiMo Code、pi-subagents 的借鉴边界。

### 说明
- 本版本主要是文档与发布元信息调整，不改变运行时 API（接口）。

## [0.4.1] - 2026-06-08

### 新增
- 新增后台任务稳定性实施方案，后续已归档到 `doc/90-归档/版本实施方案/42-v0.4.1-后台任务稳定性实施方案.md`。
- 新增 `tests/index-background-run.test.ts`，覆盖“后台 `run` 立即返回后不再调用 `onUpdate`（流式更新回调）”的回归场景。
- 新增根目录 `CHANGELOG.md`，用于记录版本级用户可感知变更。
- `dteam-report`（结果报告）完成消息进入主对话，避免用户只看到启动 `runId`。

### 变更
- `dteam(action="run")` 明确采用**后台任务模式**：启动时只返回 `runId`（任务编号），实时进度主要通过 `/dteam` 面板、widget、状态栏观察，完成后再通过 `dteam-report` 通知主对话。
- 启动通道与运行态展示通道分离：工具调用返回后，后台执行只更新 UI / 状态栏 / 通知，不再借用已结束的工具调用通道。
- 保留 `availableTools`（可用工具列表）方案 D：继续由主 LLM 显式传入 worker 可用工具宇宙；dteam 不扫描运行时已加载工具。
- 文档导航、路线图、API 参考、系统架构说明同步更新为后台任务模型。

### 修复
- 修复后台任务在工具调用已结束后仍继续使用 `onUpdate` 导致的 `Agent listener invoked outside active run` 闪退问题。
- 去除后台 run 对 `onUpdate` 的依赖，避免越界发送 partial update（局部更新）。

### 验证
- `npm run build` 通过。
- `npm test` 通过（当前基线：16 个测试文件全通过）。

### 影响
- 用户调用 `dteam(action="run")` 后会立即拿到 `runId`，不应期待工具调用本身持续 stream（流式输出）。
- 实时过程请看 `/dteam` 面板；完成结果看 `dteam-report`。
