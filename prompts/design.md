---
description: 方案制定者启动器 - 评估需求、制定方案
argument-hint: "<任务描述>"
---
使用 design agent 评估需求、制定方案。

任务：$@

## 第一步：查找或创建 task

使用 task_search 搜索与任务描述匹配的 task。

- **找到** → 使用 task_read 读取已有 task 和探索发现
- **没找到** → 使用 task_create 创建新 task

## 第二步：需求评估

- 评估任务复杂度
- 补充 scope（包含/排除）
- 补充验收条件（GWT 格式）

## 第三步：方案设计

- 使用 reference_architecture 查询架构类型参考
- 制定实现方案
- 制定技术选型和权衡取舍
- 拆分任务（如果需要）

## 第四步：写入讨论决策

**必须**使用 task_update 写入 task 的「阶段记录」→「讨论决策」section，内容包括：
- 最终方案
- 技术选型理由
- 权衡取舍
- 实施步骤

这些信息会自动传递给 build agent 作为执行依据。
