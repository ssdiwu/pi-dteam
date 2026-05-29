---
title: "Superpowers 借鉴"
kind: research
domain: 研究
status: stable
tags: [Superpowers, 借鉴]
created: 2026-05-29
updated: 2026-05-29
---

# Superpowers 借鉴

> **定位**：Superpowers 项目的设计理念和可借鉴之处。

## Superpowers 核心特点

### 1. 技能框架

Superpowers 是一个完整的软件开发方法论：
- 可组合的技能：brainstorming、writing-plans、subagent-driven-development
- 自动触发技能，无需特殊命令
- 强调 TDD、YAGNI、DRY

### 2. 子代理驱动开发

- 每个任务独立上下文
- 两阶段审查：spec compliance + code quality
- 自动化执行

### 3. 技能自动触发

- 根据上下文自动激活技能
- 用户不需要手动触发

## 可借鉴的设计

### 1. 技能自动触发

**Superpowers 做法**：
- brainstorming 在写代码前自动触发
- writing-plans 在设计批准后自动触发
- subagent-driven-development 在计划后自动触发

**dteam 借鉴**：
- explore 在任务创建后自动触发
- design 在探索完成后自动触发
- build 在设计完成后自动触发

### 2. 子代理驱动开发

**Superpowers 做法**：
- 每个任务独立上下文
- 两阶段审查

**dteam 借鉴**：
- worker 执行任务
- check 验收结果
- close 归档任务

### 3. TDD 集成

**Superpowers 做法**：
- 严格的 RED-GREEN-REFACTOR 循环
- 测试优先

**dteam 借鉴**：
- 验收条件包含测试
- check 验证测试通过

## 差异化设计

### 1. 执行模式

| 维度 | Superpowers | dteam |
|------|-------------|-------|
| 执行模式 | 仅子代理 | solo/chain/team |
| 并行能力 | 有限 | 支持多 worker 并行 |

### 2. 角色系统

| 维度 | Superpowers | dteam |
|------|-------------|-------|
| 角色定义 | 隐式 | 5 个专职角色 |
| 职责边界 | 模糊 | 清晰的角色职责 |

## 不借鉴的设计

### 1. 复杂的技能系统

Superpowers 的技能系统过于复杂，学习成本高。

### 2. 隐式触发

Superpowers 的技能触发是隐式的，用户可能不理解为什么触发。

### 3. 缺乏显式状态管理

Superpowers 没有显式的状态管理，依赖隐式规则。
