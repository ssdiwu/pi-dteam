---
title: "solo 编排模式"
kind: definition
domain: P1-组装与行为层
status: stable
tags: [solo, 编排模式]
created: 2026-05-29
updated: 2026-05-29
---

# solo 编排模式

> **定位**：dteam 的单任务执行模式。派一个角色执行一个任务。

## 一句话

solo 是 dteam 的**有效模式**——专注于单一任务的深入执行。

## 核心特征

| 特征 | 值 |
|------|-----|
| 定位 | 有效（专注、深入） |
| 适用场景 | 小任务（<100行，<3文件） |
| 子模式 | simple / maker-checker / adaptive |
| 嵌套 | 不能嵌套（叶子节点） |

## 三种子模式

### simple（极简模式）

**适用场景**：极简改动（1-2行）

**流程**：
```
任务 → 执行 → 完成
```

**特点**：
- 直接执行，无额外检查
- 适用于 typo 修复、配置修改等

### maker-checker（执行-检查模式）

**适用场景**：标准任务（默认）

**流程**：
```
任务 → maker 执行 → checker 检查 → 完成
                    ↓
                不通过 → maker 修复 → checker 重新检查
```

**特点**：
- build 执行，check 检查
- 确保质量
- 适用于大多数任务

### adaptive（自适应模式）

**适用场景**：复杂无冲突

**流程**：
```
任务 → design 规划 → build 执行 → check 评估 → 完成
                    ↓
                不通过 → replan → build 重新执行
```

**特点**：
- 先规划再执行
- 支持 replan
- 适用于复杂任务

## 接口定义

```typescript
interface SoloConfig {
  mode: "solo";
  agent: RoleName;           // 角色名
  task: string;              // 任务描述
  sub_mode?: "simple" | "maker-checker" | "adaptive";
  background?: boolean;      // 是否后台执行
}
```

## 使用示例

### simple 示例

```json
{
  "mode": "solo",
  "agent": "build",
  "task": "修改登录页面 logo 尺寸",
  "sub_mode": "simple"
}
```

### maker-checker 示例

```json
{
  "mode": "solo",
  "agent": "build",
  "task": "实现用户登录 API",
  "sub_mode": "maker-checker"
}
```

### adaptive 示例

```json
{
  "mode": "solo",
  "agent": "build",
  "task": "重构认证模块",
  "sub_mode": "adaptive"
}
```

## 决策逻辑

```
任务复杂度？
├─ 极简（1-2行） → simple
├─ 标准（默认） → maker-checker
└─ 复杂但无冲突 → adaptive
```

## 不变量

1. solo 只能有一个角色和一个任务
2. simple 模式无检查步骤
3. maker-checker 模式必须有 build 和 check
4. adaptive 模式必须有 design、build 和 check
5. solo 不能嵌套
