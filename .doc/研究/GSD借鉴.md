---
title: "GSD 借鉴"
kind: research
domain: 研究
status: stable
tags: [GSD, 借鉴]
created: 2026-05-29
updated: 2026-05-29
---

# GSD 借鉴

> **定位**：GSD（Get-Shit-Done）项目的设计理念和可借鉴之处。

## GSD 核心特点

### 1. 轻量级元提示

GSD 解决上下文腐烂问题：
- 多代理架构：研究者、规划者、执行者各自独立上下文
- 结构化产物：PROJECT.md、REQUIREMENTS.md等
- 验证步骤：专门的调试代理诊断失败

### 2. 六步循环

```
new-project → discuss → plan → execute → verify → ship
```

### 3. 独立上下文

每个阶段独立代理，避免上下文污染。

## 可借鉴的设计

### 1. 文件存储结构

**GSD 做法**：
```
.gsd/
├── tasks/
│   ├── task-001.md
│   └── task-002.md
└── archive/
    └── completed/
```

**dteam 借鉴**：
```
.dteam/
├── task/
│   └── {name}-{timestamp}-{random4}.md
└── archive/
    └── {name}-{timestamp}-{random4}.md
```

### 2. 任务生命周期

**GSD 做法**：
```
created → in_progress → done
```

**dteam 借鉴**：
```
todo → InSpec → InProgress → Done
```

### 3. 工具命令设计

**GSD 做法**：
```bash
gsd create "任务名称"
gsd list
gsd start task-001
gsd complete task-001
```

**dteam 借鉴**：
```bash
task.create "任务名称"
task.read {id}
task.update {id} --section=执行记录
task.complete {id} --item=条件1
task.archive {id}
```

## 差异化设计

### 1. 执行模式

| 维度 | GSD | dteam |
|------|-----|-------|
| 执行模式 | 仅串行 | solo/chain/team |
| 并行能力 | 无 | 支持多 worker 并行 |

### 2. 角色系统

| 维度 | GSD | dteam |
|------|-----|-------|
| 角色定义 | 无 | 5 个专职角色 |
| 职责边界 | 模糊 | 清晰的角色职责 |

## 不借鉴的设计

### 1. 过度简化的状态机

GSD 的状态机过于简单，无法表达复杂任务的生命周期。

### 2. 缺乏并行能力

GSD 不支持并行执行，无法满足大型任务的效率需求。

### 3. 无角色系统

GSD 没有角色概念，所有操作由同一执行者完成。
