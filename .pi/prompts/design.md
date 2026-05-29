---
description: 方案制定者启动器 - 制定任务方案
argument-hint: "<任务描述>"
---
制定任务方案。

任务：$@

请执行：

1. **创建task**（如果不存在）：使用task.create工具创建task
   - name：任务名称
   - type：任务类型（functional/ui/bugfix/refactor/infra）
   - why：为什么要做
   - goal：目标是什么

2. **探索代码库**：
   - 搜索相关代码文件
   - 分析现有架构
   - 确认约束条件

3. **制定方案**：使用task.update工具写入task.md的"讨论决策"section
   - 方案选型（排除哪些方案，选定哪个方案）
   - 实现规格（具体的实现细节）
   - 依赖关系（依赖哪些模块）

4. **制定验收条件**：使用task.update工具写入task.md的"验收条件"section
   - 使用GWT格式（Given-When-Then）
   - 每条验收条件必须可判定
   - 包含对应的测试

注意：
- 不修改业务代码
- 不跳过explore产出直接细化
- 产出模糊的 acceptance（每条必须 GWT 格式、可判定）
- 不自行宣布 Ready
