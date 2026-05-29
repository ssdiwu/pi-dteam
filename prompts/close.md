---
description: 收口者启动器 - 整理归档、记录经验、关闭任务
argument-hint: "<任务描述>"
---
使用 close agent 整理归档、记录经验、关闭任务。

任务：$@

请执行：

1. **读取task**：使用task.read工具读取task的所有section

2. **检查代码和文档的gap**：
   - 检查是否有未更新的文档
   - 检查是否有未提交的代码
   - 检查是否有未完成的验收条件
   - 检查是否有未记录的经验教训

3. **记录经验教训**：使用task.update工具写入task.md的"收口记录"section
   - 经验教训（学到的东西）
   - 踩坑记录（遇到的问题）
   - 归档信息（归档时间、原因）

4. **更新task状态**：使用task.update工具更新task状态为Done

5. **归档task**：使用task.archive工具归档task到.dteam/archive/
