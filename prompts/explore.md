---
description: 探索者启动器 - 搜集内部和外部信息
argument-hint: "<任务描述>"
---
使用 explore agent 搜集内部和外部信息。

任务：$@

## 第一步：查找或创建 task

使用 task_search 搜索与任务描述匹配的 task。

- **找到** → 使用 task_read 读取已有 task，继续补充探索
- **没找到** → 使用 task_create 创建新 task（类型根据任务自动判断）

## 第二步：搜集内部信息

### 探索方式选择

根据探索范围选择执行方式：

**简单探索**（单个目录/文件）：
- 直接执行，不需要worker

**复杂探索**（整个项目，需要上下文积累）：
- 使用 `worker_create` 创建探索worker
- 使用 `worker_start` 启动探索
- 使用 `worker_getMemory` 获取探索上下文
- 使用 `worker_sendSignal` 报告发现

### 探索内容

- 搜索项目内的相关代码
- 分析现有架构
- 查看相关文档
- 发现约束条件

## 第三步：搜集外部信息

- 联网搜索同类问题
- 查找同类项目
- 参考最佳实践

## 第四步：写入探索发现

**必须**使用 task_update 写入 task 的「阶段记录」→「探索发现」section，内容包括：
- 发现的关键信息
- 约束条件和风险点
- 建议方向

这些信息会自动传递给后续的 design 和 build agent。
