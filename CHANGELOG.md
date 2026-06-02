# Changelog

## Unreleased

- 重构 worker widget 为多 worker 单行实时进度视图，支持多个后台 worker 并存、信号角标（progress/blocked/found/help）、chain/team 嵌套关系可视化；status bar 显示极简计数 `N workers · M running`。
- 修复 worker widget 多 worker 状态合并到 `unknown` 的 bug：`showWorkerStatus` 新签名 `(ctx, workerId, state)`。
- 修复 `P2/runSolo/Chain/Team` 内部用临时 ID emit 信号与外层 workerId 不一致的问题：新增 `parentWorkerId` 形参贯通 P2/P3 全链路。
- 修复 `P4/dteamTool` 使用动态 import 导致 onProgress/onComplete 事件丢失的问题：改静态 import。
- 修复 `WorkerStatusList.dispose()` 和 `WorkerFullscreenView.dispose()` 未清 `setInterval` 的内存泄漏问题。
- 新增 `WorkerProgressStore`（模块级 `Map<workerId, WorkerProgress>`）作为 widget 渲染单一数据源。
- 新增 `ExecutionContext.parentWorkerId?` / `chainIndex?` / `chainTotal?` 字段支持嵌套可视化。
- 新增测试：`tests/P4/store.test.ts`（23 用例）、`tests/integration/multi-worker.test.ts`（6 用例，含 2 worker 并行不覆盖核心场景）。
- 新增 `normalizeOptions()`，统一修复 worker options 被 JSON 序列化为对象形态的问题。
- 增强 `SignalLog`：追加前检查单行 JSONL 字节数，超过 4096 字节抛 `SignalTooLargeError`。
- 将 `SignalLog.tail()` 改为流式逐行读取，降低大文件读取内存占用。
- 为测试目录补充说明，并在 `npm test` 前自动执行 `npm run build`。
- 同步根 README 的 6 角色说明，补充 `deploy` 角色。
- 拆分 `spawn.ts` 主流程，补齐 `AgentProgress` 更新推送、blocked 信号和 spawn artifact 落盘。
- 增加 chain 嵌套 team fixture，并让 chain 后续步骤接收上一阶段输出。
