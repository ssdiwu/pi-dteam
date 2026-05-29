---
title: "task 数据模型"
kind: definition
domain: P0-原子层
status: stable
tags: [task, 核心对象, 数据模型]
created: 2026-05-29
updated: 2026-05-29
---

# task 数据模型

> **定位**：dteam 的原子层。定义 task 的数据结构，不依赖其他概念。

## 一句话

task 是 dteam 的**工作主语**——一个完整的、有明确边界的功能或任务。

## 核心特征

| 特征 | 值 |
|------|-----|
| 生命周期 | 永久态：创建 → 执行 → 归档 |
| 持久化 | `.dteam/task/{name}-{timestamp}-{random4}.md` |
| 格式 | Markdown（统一格式） |
| 状态 | 5个：todo / InSpec / InProgress / Done / Cancelled |

## 文件命名

```
{name}-{timestamp}-{random4}.md
```

- `name`：任务名称（简短描述）
- `timestamp`：`YYYYMMDDHHmmss` 格式
- `random4`：4 位随机字符（防碰撞）
- 示例：`实现用户认证-20260529141206-ofi4.md`

## 文件结构

```markdown
# {任务名称}

## 基本信息
- ID: {timestamp}-{random4}
- 类型: functional/ui/bugfix/refactor/infra
- 创建时间: {timestamp}
- 状态: todo/InSpec/InProgress/Done/Cancelled

## 目标
- 为什么: {why}
- 做什么: {goal}

## 范围
- 包含: {includes}
- 排除: {excludes}

## 验收条件（GWT + 测试）
- [ ] 条件1（含测试）
- [ ] 条件2（含测试）
- [ ] 条件3（含测试）

## 阶段记录
### 探索发现
...

### 讨论决策
...

### 执行记录
...
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ID | string | ✅ | 全局唯一标识，格式 `{timestamp}-{random4}` |
| 类型 | enum | ✅ | functional / ui / bugfix / refactor / infra |
| 创建时间 | ISO8601 | ✅ | 创建时间 |
| 状态 | enum | ✅ | todo / InSpec / InProgress / Done / Cancelled |
| 为什么 | string | ✅ | 为什么要做这个任务 |
| 做什么 | string | ✅ | 目标是什么 |
| 包含 | string | ⚪ | 范围包含 |
| 排除 | string | ⚪ | 范围排除 |
| 验收条件 | checklist | ✅ | GWT 格式 + 测试 |
