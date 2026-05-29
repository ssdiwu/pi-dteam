---
title: "dteam 文档导航"
kind: overview
domain: 治理
status: stable
tags: [导航]
created: 2026-05-29
updated: 2026-05-29
---

# dteam 文档导航

> dteam 设计真相源索引。

## 项目概述

dteam 是一个**轻量级的多代理编排系统**。通过 solo/chain/team 三种模式，在高效与有效之间取得平衡。

**核心概念**：
- task：工作主语对象
- worker：执行单元（solo/chain/team）
- 角色：5个执行角色（explore/design/build/check/close）
- 信号：即时通信机制

## 文档体系

| 层 | 回答什么 | 位置 |
|---|---|---|
| **P0-原子层** | 是什么 | [P0-原子层/](./P0-原子层/) |
| **P1-基础层** | 谁来做 | [P1-基础层/](./P1-基础层/) |
| **P2-组合层** | 怎么组合 | [P2-组合层/](./P2-组合层/) |
| **P3-编排层** | 怎么编排 | [P3-编排层/](./P3-编排层/) |
| **治理** | 做什么/不做什么 | [治理/](./治理/) |
| **研究** | 凭什么 | [研究/](./研究/) |
| **规范** | 怎么写 | [规范/](./规范/) |

## 依赖关系

```
P0-原子层（task、信号类型）
    ↑
P1-基础层（角色、工具接口）
    ↑
P2-组合层（worker、信号总线、solo/chain/team）
    ↑
P3-编排层（编排决策逻辑、worker编排层）
```

## 分类导航

| 你想了解什么 | 去哪里 |
|---|---|
| task 数据模型 | [P0-原子层/task.md](./P0-原子层/task.md) |
| 信号类型 | [P0-原子层/信号类型.md](./P0-原子层/信号类型.md) |
| 角色定义 | [P1-基础层/角色.md](./P1-基础层/角色.md) |
| explore 角色 | [P1-基础层/explore.md](./P1-基础层/explore.md) |
| design 角色 | [P1-基础层/design.md](./P1-基础层/design.md) |
| build 角色 | [P1-基础层/build.md](./P1-基础层/build.md) |
| check 角色 | [P1-基础层/check.md](./P1-基础层/check.md) |
| close 角色 | [P1-基础层/close.md](./P1-基础层/close.md) |
| 工具接口 | [P1-基础层/工具接口.md](./P1-基础层/工具接口.md) |
| worker 概念 | [P2-组合层/worker.md](./P2-组合层/worker.md) |
| 信号总线 | [P2-组合层/信号总线.md](./P2-组合层/信号总线.md) |
| solo 编排模式 | [P2-组合层/solo.md](./P2-组合层/solo.md) |
| chain 编排模式 | [P2-组合层/chain.md](./P2-组合层/chain.md) |
| team 编排模式 | [P2-组合层/team.md](./P2-组合层/team.md) |
| 编排决策逻辑 | [P3-编排层/编排决策逻辑.md](./P3-编排层/编排决策逻辑.md) |
| worker 编排层 | [P3-编排层/worker编排层.md](./P3-编排层/worker编排层.md) |
| 决策记录 | [治理/决策记录.md](./治理/决策记录.md) |
| GSD 借鉴 | [研究/GSD借鉴.md](./研究/GSD借鉴.md) |
| Superpowers 借鉴 | [研究/Superpowers借鉴.md](./研究/Superpowers借鉴.md) |
| 术语规范 | [规范/术语与文风规范.md](./规范/术语与文风规范.md) |
| 文件布局 | [规范/文件布局规范.md](./规范/文件布局规范.md) |

## 核心设计原则

1. **简单**：一个 .md 文件包含所有内容
2. **可读**：对人类和 AI 都友好
3. **可追溯**：阶段性内容保留
4. **可操作**：通过工具可以只读/更新部分内容

## 快速开始

1. 创建任务：`task.create`
2. 读取任务：`task.read`
3. 更新任务：`task.update`
4. 标记完成：`task.complete`
5. 归档任务：`task.archive`
