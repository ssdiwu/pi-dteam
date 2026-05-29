---
title: "team 编排模式"
kind: definition
domain: P2-组合层
status: stable
tags: [team, 编排, 并行]
created: 2026-05-29
updated: 2026-05-29
---

# team 编排模式

> **定位**：dteam 的组合层。定义 team 模式的执行逻辑。依赖 worker（P2）。

## 一句话

team 是 dteam 的**并行模式**——多个 worker 同时执行任务，高效协作。

## 适用场景

- 任务可以并行执行
- 需要多人协作
- 需要讨论和投票

## 配置示例

```typescript
const config: WorkerConfig = {
  type: "team",
  task: "并行执行任务",
  style: "pragmatist",
  options: [
    { type: "workers", value: [
      { type: "solo", task: "任务1", style: "pragmatist", options: [{ type: "role", value: "explore" }] },
      { type: "solo", task: "任务2", style: "pragmatist", options: [{ type: "role", value: "design" }] }
    ]},
    { type: "rounds", value: 3 },
    { type: "voting", value: true }
  ]
};
```

## 执行流程

```
创建 team worker
    │
    ▼
加载 worker 列表
    │
    ▼
并行执行所有 worker
    │
    ├─ worker1 ─┐
    ├─ worker2 ─┼─ 等待所有完成
    └─ worker3 ─┘
    │
    ▼
收集结果
    │
    ├─ 启用投票 → 投票决定最终结果
    │
    └─ 未启用 → 汇总结果
    │
    ▼
完成
```

## 配置字段

| 字段 | 必填 | 说明 |
|------|------|------|
| type | ✅ | 固定为 "team" |
| task | ✅ | 任务描述 |
| style | ✅ | 思考方式 |
| workers | ✅ | worker 列表（SoloConfig 或 ChainConfig） |
| rounds | ⚪ | 讨论轮数（默认5） |
| voting | ⚪ | 是否启用投票（默认false） |

## 嵌套能力

team 的 workers 可以包含：
- solo：单任务
- chain：串行任务

**不能**包含：
- team：避免过度嵌套

## 讨论机制

当启用讨论时：
1. 每个 worker 提交结论
2. 进行多轮讨论
3. 最终通过投票或汇总得出结果

## 投票机制

当启用投票时：
1. 每个 worker 投票
2. checker 权重为3
3. 得票最多者胜出

## 不变量

1. team 必须有 workers
2. workers 不能为空
3. 嵌套深度不超过四层
