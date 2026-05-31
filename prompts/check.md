---
description: 验收者启动器 - 检查代码质量、验证结果
argument-hint: "<任务描述>"
---
使用 check agent 检查代码质量、验证结果。

任务：$@

请执行：

1. **读取task**：使用task.read工具读取task的"验收条件"和"执行记录"section

2. **检查代码问题**：
   - Bug和逻辑错误
   - 安全问题
   - 性能问题
   - 可读性问题

3. **检查代码和文档一致性**：
   - 文档是否与代码匹配
   - API文档是否更新
   - README是否需要更新
   - 注释是否准确

4. **逐条检查验收条件**：
   - 使用GWT格式检查每条验收条件
   - 标记PASS/FAIL/BLOCKER
   - 记录问题和修复建议

5. **更新task**：
   - **必须**使用 task_update 工具更新 task.md 的「验收条件」section，标记每条 PASS/FAIL/BLOCKER
   - **必须**使用 task_update 工具写入 task.md 的「阶段记录」→「执行记录」section，补充验收发现
