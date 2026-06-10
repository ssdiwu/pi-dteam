# Changelog

本文件记录 dteam 的用户可感知变更与关键实现收口。  
格式参考 Keep a Changelog，但保持中文、简洁、面向项目实际。

## [0.4.1] - 2026-06-08

### 新增
- 新增 `doc/40-版本实施方案/42-v0.4.1-后台任务稳定性实施方案.md`，明确 `v0.4.1` 的目标是收敛后台任务模型。
- 新增 `tests/index-background-run.test.ts`，覆盖“后台 `run` 立即返回后不再调用 `onUpdate`（流式更新回调）”这一回归场景。
- 新增根目录 `CHANGELOG.md`，用于记录版本级用户可感知变更。

### 变更
- `dteam(action="run")` 明确采用**后台任务模式**：启动时只返回 `runId`（任务编号），实时进度主要通过 `/dteam` 面板、widget（小组件）、状态栏观察，完成后再通过 `dteam-report`（结果报告）消息通知主对话。
- 保留 `availableTools`（可用工具列表）透传方案，继续由主 LLM 显式传入 worker 可用工具宇宙。
- 文档导航、路线图、API 参考、系统架构说明已同步更新为新的后台任务表述。

### 修复
- 修复后台任务在工具调用已结束后仍继续使用 `onUpdate` 导致的 `Agent listener invoked outside active run` 闪退问题。
- 去除后台 run 对 `onUpdate` 的依赖，避免越界发送 partial update（局部更新）。

### 验证
- `npm run build` 通过。
- `npm test` 通过（当前 267 个测试全通过）。
