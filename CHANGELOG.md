# Changelog

本文件记录 dteam 的用户可感知变更与关键实现收口。  
格式参考 Keep a Changelog，但保持中文、简洁、面向项目实际。

## [0.5.0] - Unreleased

### 计划
- 打磨 `/dteam` 面板和 widget（小组件）：完成项保留、4 状态清晰、mode 标签稳定展示。
- 加入轻量并行治理：`PlanStep.files` 展示、显式同文件冲突预检、冲突 step 自动拆批。
- 强化 `dteam-report`（结果报告）：保留 worker tree（工作树）结构、plan mode、files / 冲突说明、失败摘要。
- 补自然语言使用示例：明确什么任务该主 LLM 直接做，什么任务该调 dteam。

### 不做
- 不做固定 6 阶段流水线。
- 不开放自定义角色系统；继续保留 5 个写死角色。
- 不默认做持久化 / resume（恢复）/ 进程级隔离。

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
