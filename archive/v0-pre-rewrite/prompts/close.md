---
description: 收口者启动器 - 整理归档、记录经验、关闭任务
argument-hint: "<任务描述>"
---
使用 close agent 整理归档、记录经验、关闭任务。

任务：$@

## 第一步：查找 task

使用 task_search 搜索与任务描述匹配的 task。

- **找到** → 继续下一步
- **没找到** → 停止，提示用户"没有找到对应 task，无法收口"

## 第二步：读取 task 全貌

使用 task_read 读取 task 的所有 section：
- 探索发现、讨论决策、执行记录
- 验收条件
- 当前状态

## 第三步：检查 gap

### 检查方式选择

根据检查复杂度选择执行方式：

**简单检查**（单个任务）：
- 直接执行，不需要worker

**复杂检查**（多个任务，需要上下文）：
- 使用 `worker_create` 创建检查worker
- 使用 `worker_start` 启动检查
- 使用 `worker_getMemory` 获取检查上下文
- 使用 `worker_sendSignal` 报告检查结果

### 检查内容

- 检查是否有未更新的文档
- 检查是否有未提交的代码
- 检查是否有未完成的验收条件
- 检查是否有未记录的经验教训

## 第四步：记录收口信息

**必须**使用 task_update 写入 task 的「阶段记录」→「收口记录」section，内容包括：
- 经验教训（学到的东西）
- 踩坑记录（遇到的问题）
- 归档信息

## 第五步：关闭并归档

1. 使用 task_update 更新 task 状态为 Done
2. 使用 task_archive 归档 task 到 .dteam/archive/
