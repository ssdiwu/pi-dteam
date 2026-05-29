---
description: 方案制定者启动器 - 评估需求、制定方案
argument-hint: "<任务描述>"
---
使用 design agent 评估需求、制定方案。

任务：$@

请执行：

1. **需求评估（didea）**：
   - 评估任务复杂度（C1-C7）
   - 决定走dfeat还是dtask路径
   - 如果是dfeat，创建task

2. **方向探索（dpth）**：
   - 补充scope（包含/排除）
   - 补充gaps（待补项）
   - 补充reality（当前现状）

3. **需求细化（dref）**：
   - 制定实现方案
   - 制定验收条件（GWT格式）
   - 拆分任务（如果需要）

4. **架构选择**：
   - 使用reference.architecture工具查询架构类型
   - 选择合适的架构模式

5. **输出方案**：使用task.update工具写入task.md的"讨论决策"section
