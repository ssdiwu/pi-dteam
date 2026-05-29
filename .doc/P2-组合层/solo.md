---
title: "solo 编排模式"
kind: definition
domain: P2-组合层
status: stable
tags: [solo, 编排模式, 组合层]
created: 2026-05-29
updated: 2026-05-29
---

# solo 编排模式

> **定位**：dteam 的组合层。定义 solo 编排模式。依赖 worker（P2）、角色（P1）。

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

**定义**：最简单的执行模式，直接执行任务，无额外检查。

**适用场景**：
- 极简改动（1-2行代码）
- typo 修复
- 配置文件修改
- 格式调整

**流程**：
```
用户需求 → build 执行 → 完成
```

**角色参与**：
- build：执行任务

**特点**：
- 无检查步骤，直接完成
- 执行速度快
- 适用于风险极低的任务

**示例**：
```json
{
  "mode": "solo",
  "agent": "build",
  "task": "修改 README.md 中的 typo",
  "sub_mode": "simple"
}
```

### maker-checker（执行-检查模式）

**定义**：标准的执行-检查模式，build 执行任务，check 验收结果。

**适用场景**：
- 标准任务（默认模式）
- 需要质量保证的任务
- 大多数开发任务

**流程**：
```
用户需求 → build 执行 → check 检查 → 完成
                    ↓
                不通过 → build 修复 → check 重新检查
```

**角色参与**：
- build：执行任务
- check：验收结果

**特点**：
- 有检查步骤，确保质量
- 支持迭代修复
- 适用于大多数任务

**示例**：
```json
{
  "mode": "solo",
  "agent": "build",
  "task": "实现用户登录 API",
  "sub_mode": "maker-checker"
}
```

### adaptive（自适应模式）

**定义**：自适应模式，先规划再执行，支持 replan。

**适用场景**：
- 复杂但无冲突的任务
- 需要先规划再执行的任务
- 不确定性较高的任务

**流程**：
```
用户需求 → design 规划 → build 执行 → check 评估 → 完成
                    ↓
                不通过 → replan → build 重新执行
```

**角色参与**：
- design：规划任务
- build：执行任务
- check：评估结果

**特点**：
- 先规划再执行，降低风险
- 支持 replan，适应变化
- 适用于复杂任务

**示例**：
```json
{
  "mode": "solo",
  "agent": "build",
  "task": "重构认证模块",
  "sub_mode": "adaptive"
}
```

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
