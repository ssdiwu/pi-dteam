---
title: "chain 编排模式"
kind: definition
domain: P2-组合层
status: stable
tags: [chain, 编排, 串行]
created: 2026-05-29
updated: 2026-05-29
---

# chain 编排模式

> **定位**：dteam 的组合层。定义 chain 模式的执行逻辑。依赖 worker（P2）。

## 一句话

chain 是 dteam 的**串行模式**——按顺序执行多个任务，一步接一步。

## 适用场景

- 任务之间有依赖关系
- 需要逐步验证
- 有冲突的串行任务

## 配置示例

```typescript
const config: WorkerConfig = {
  type: "chain",
  task: "实现用户认证",
  style: "pragmatist",
  options: [
    { type: "steps", value: [
      { type: "solo", task: "探索项目结构", style: "pragmatist", options: [{ type: "role", value: "explore" }] },
      { type: "solo", task: "设计方案", style: "pragmatist", options: [{ type: "role", value: "design" }] },
      { type: "solo", task: "实现代码", style: "pragmatist", options: [{ type: "role", value: "build" }] }
    ]},
    { type: "maxDepth", value: 2 }
  ]
};
```

## 执行流程

```
创建 chain worker
    │
    ▼
加载步骤列表
    │
    ▼
按顺序执行步骤
    │
    ├─ 步骤1 → 成功 → 步骤2
    │           │
    │           └─ 失败 → 发送 blocked 信号
    │
    ├─ 步骤2 → 成功 → 步骤3
    │           │
    │           └─ 失败 → 发送 blocked 信号
    │
    └─ 步骤N → 成功 → 完成
                │
                └─ 失败 → 发送 blocked 信号
```

## 配置字段

| 字段 | 必填 | 说明 |
|------|------|------|
| type | ✅ | 固定为 "chain" |
| task | ✅ | 任务描述 |
| style | ✅ | 思考方式 |
| steps | ✅ | 步骤列表（SoloConfig 或 TeamConfig） |
| maxDepth | ⚪ | 嵌套深度（默认4） |

## 嵌套能力

chain 的 steps 可以包含：
- solo：单任务
- team：并行任务

**不能**包含：
- chain：避免过度嵌套

## 不变量

1. chain 必须有 steps
2. steps 不能为空
3. 嵌套深度不超过四层
