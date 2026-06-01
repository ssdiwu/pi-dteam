# Changelog

## Unreleased

- 新增 `normalizeOptions()`，统一修复 worker options 被 JSON 序列化为对象形态的问题。
- 增强 `SignalLog`：追加前检查单行 JSONL 字节数，超过 4096 字节抛 `SignalTooLargeError`。
- 将 `SignalLog.tail()` 改为流式逐行读取，降低大文件读取内存占用。
- 为测试目录补充说明，并在 `npm test` 前自动执行 `npm run build`。
- 同步根 README 的 6 角色说明，补充 `deploy` 角色。
- 拆分 `spawn.ts` 主流程，补齐 `AgentProgress` 更新推送、blocked 信号和 spawn artifact 落盘。
- 增加 chain 嵌套 team fixture，并让 chain 后续步骤接收上一阶段输出。
