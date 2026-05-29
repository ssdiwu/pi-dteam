---
title: "team 编排模式"
kind: definition
domain: P2-组合层
status: stable
tags: [team, 编排模式, 组合层]
created: 2026-05-29
updated: 2026-05-29
---

# team 编排模式

> **定位**：dteam 的组合层。定义 team 编排模式。依赖 worker（P2）、角色（P1）。

## 一句话

team 是 dteam 的**高效模式**——适用于可并行的任务。

## 核心特征

| 特征 | 值 |
|------|-----|
| 定位 | 高效（并行、快速） |
| 适用场景 | 可并行的任务（优先选择） |
| 嵌套 | 可嵌套 solo 和 chain |

## 适用场景

**典型场景**：
- 多个任务无依赖关系（如：同时修改多个模块）
- 需要同时修改多个文件（如：重构多个组件）
- 可并行的任务（优先选择）（如：批量更新配置）

**具体示例**：
- 同时重构多个独立模块：用户模块、订单模块、支付模块
- 批量更新多个配置文件：数据库配置、缓存配置、日志配置
- 并行实现多个独立功能：登录功能、注册功能、密码重置功能

## 接口定义

```typescript
interface TeamConfig {
  mode: "team";
  tasks: TeamTask[];
}

interface TeamTask {
  type: "solo" | "chain";
  agent?: RoleName;
  task?: string;
  steps?: ChainStep[];  // type=chain 时使用
}
```

## 使用示例

### 基础示例

```json
{
  "mode": "team",
  "tasks": [
    { "type": "solo", "agent": "build", "task": "重构用户模块" },
    { "type": "solo", "agent": "build", "task": "重构订单模块" },
    { "type": "solo", "agent": "build", "task": "重构支付模块" }
  ]
}
```

### 嵌套示例

```json
{
  "mode": "team",
  "tasks": [
    { "type": "solo", "agent": "build", "task": "重构前端" },
    {
      "type": "chain",
      "steps": [
        { "agent": "explore", "task": "探索后端架构" },
        { "agent": "build", "task": "重构后端" }
      ]
    }
  ]
}
```

## 执行流程

```
task1 ─┐
task2 ─┼─→ 并行执行 → 汇总结果 → 完成
task3 ─┘
```

## 投票机制

team 支持投票机制，用于解决多个 worker 的意见分歧：

| 配置 | 说明 | 默认值 |
|------|------|--------|
| `votingEnabled` | 是否启用投票 | false |
| `checkerWeight` | checker 投票权重 | 3 |
| `agentCount` | 多 Agent 讨论数量 | 3（范围 2-10） |
| `maxDiscussionRounds` | 讨论阶段最大轮数 | 5 |

## 冲突解决

当多个 worker 的产出存在冲突时：

1. **投票机制**：如果启用投票，由投票决定
2. **checker 决定**：如果未启用投票，由 checker 角色决定
3. **用户介入**：如果无法自动解决，上报用户

## 决策逻辑

```
任务可并行？
├─ 是 → team（优先选择）
└─ 否 → 考虑 chain 或 solo
```

## 不变量

1. team tasks 不能为空
2. 各 worker 独立执行，互不干扰
3. 一个 worker 失败不影响其他 worker
4. 最大嵌套深度四层
