---
title: "worker 概念"
kind: definition
domain: P2-组合层
status: stable
tags: [worker, 组合层]
created: 2026-05-29
updated: 2026-05-29
---

# worker 概念

> **定位**：dteam 的组合层。定义 worker 的基本概念。依赖信号类型（P0）。

## 一句话

worker 是 dteam 的**执行引擎**——通过 solo、chain、team 三种模式，实现任务的高效执行。

## 核心特征

| 特征 | 值 |
|------|-----|
| 类型 | 3种：solo / chain / team |
| 通信 | 信号机制（4个信号 + 5个策略 = 9种） |
| 嵌套 | 最大4层 |

## 三种模式

| 模式 | 定位 | 适用场景 |
|------|------|----------|
| **solo** | 有效 | 小任务（<100行，<3文件） |
| **chain** | 综合 | 有冲突的串行任务 |
| **team** | 高效 | 可并行的任务（优先选择） |

## 决策优先级

```
team > solo > chain
```

## 统一配置接口

```typescript
interface WorkerConfig {
  type: "solo" | "chain" | "team";
  task: string;
  style: string;
  options?: WorkerOption[];
}

type WorkerOption = 
  | { type: "role"; value: string }
  | { type: "steps"; value: ChainStep[] }
  | { type: "workers"; value: Worker[] }
  | { type: "rounds"; value: number }
  | { type: "voting"; value: boolean }
  | { type: "maxDepth"; value: number };
```

## 配置矩阵

| 字段 | solo | chain | team | 说明 |
|------|------|-------|------|------|
| type | ✅ 必填 | ✅ 必填 | ✅ 必填 | 类型选择 |
| task | ✅ 必填 | ✅ 必填 | ✅ 必填 | 任务描述 |
| style | ✅ 必填 | ✅ 必填 | ✅ 必填 | 思考方式 |
| role | ✅ 必填 | ❌ 忽略 | ❌ 忽略 | 角色名 |
| steps | ❌ 忽略 | ✅ 必填 | ❌ 忽略 | 步骤列表 |
| workers | ❌ 忽略 | ❌ 忽略 | ✅ 必填 | worker列表 |
| rounds | ❌ 忽略 | ❌ 忽略 | ⚪ 可选 | 讨论轮数 |
| voting | ❌ 忽略 | ❌ 忽略 | ⚪ 可选 | 是否投票 |
| maxDepth | ❌ 忽略 | ⚪ 可选 | ❌ 忽略 | 嵌套深度 |

## 模式详情

详见：
- [solo.md](./solo.md)：solo 编排模式
- [chain.md](./chain.md)：chain 编排模式
- [team.md](./team.md)：team 编排模式

## 嵌套规则

| 规则 | 说明 |
|------|------|
| solo 不能嵌套 | 叶子节点，不可再分 |
| chain steps 可嵌套 | steps 中可包含 solo 和 team |
| team workers 可嵌套 | workers 中可包含 solo 和 chain |
| 最大深度四层 | 防止过度嵌套 |

## 信号机制

worker 通过信号总线进行即时通信：

| 类别 | 信号 | 说明 |
|------|------|------|
| 状态报告 | progress, blocked, found | worker 报告当前状态 |
| 协调请求 | help | worker 请求外部帮助 |
| 策略恢复 | retry, adjust, switch, replan, learn | 自动恢复机制 |

详见 [信号类型.md](../P0-原子层/信号类型.md)

## 不变量

1. solo 必须有 role
2. chain 必须有 steps
3. team 必须有 workers
4. 嵌套深度不超过四层
