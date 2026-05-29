---
description: 验收者启动器 - 检查代码质量、验证结果
argument-hint: "<任务描述>"
---
验收任务。

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

5. **更新task**：使用task.update工具更新task.md的"验收条件"section

注意：
- 不修改业务代码
- 基于代码事实判定，不基于感觉
- 每条 acceptance 必须有 PASS/FAIL 判定
- 发现 BLOCKER 必须明确标注
