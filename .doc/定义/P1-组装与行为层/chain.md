---
title: "chain 编排模式"
kind: definition
domain: P1-组装与行为层
status: stable
tags: [chain, 编排模式]
created: 2026-05-29
updated: 2026-05-29
---

# chain 编排模式

> **定位**：dteam 的串行执行模式。按顺序执行多个任务，前一个完成才执行下一个。

## 一句话

chain 是 dteam 的**综合模式**——适用于有依赖关系的串行任务。

## 核心特征

| 特征 | 值 |
|------|-----|
| 定位 | 综合（串行+并行混合） |
| 适用场景 | 有冲突的串行任务 |
| 嵌套 | 可嵌套 solo 和 team |

## 适用场景

- 任务之间有依赖关系
- 需要按步骤推进
- 有冲突的串行任务
- 先探索后实现

## 接口定义

```typescript
interface ChainConfig {
  mode: "chain";
  steps: ChainStep[];
}

interface ChainStep {
  agent: RoleName;
  task: string;
  // 或嵌套其他模式
  type?: "solo" | "team";
  config?: SoloConfig | TeamConfig;
}
```

## 使用示例

### 基础示例

```json
{
  "mode": "chain",
  "steps": [
    { "agent": "explore", "task": "探索代码库" },
    { "agent": "design", "task": "设计方案" },
    { "agent": "build", "task": "实现功能" },
    { "agent": "check", "task": "验证结果" }
  ]
}
```

### 嵌套示例

```json
{
  "mode": "chain",
  "steps": [
    { "agent": "explore", "task": "探索整体架构" },
    {
      "mode": "team",
      "tasks": [
        { "type": "solo", "agent": "build", "task": "并行任务 A" },
        { "type": "solo", "agent": "build", "task": "并行任务 B" }
      ]
    },
    { "agent": "check", "task": "最终检查" }
  ]
}
```

## 执行流程

```
step1 → step2 → step3 → ... → 完成
  ↓
失败 → 立即返回，后续步骤跳过
```

## 失败策略

- 前一步失败（isError）则**立即返回**，后续步骤跳过
- 支持双向沟通：chain 可以接收 solo 的信号，也可以向 solo 发送反馈
- 重试策略：模型/API 错误 → 依次尝试 fallback 模型列表；Agent 逻辑错误 → 同模型重试 1 次

## 决策逻辑

```
任务有依赖关系？
├─ 是 → chain
└─ 否 → 考虑 team 或 solo
```

## 不变量

1. chain steps 不能为空
2. 前一步失败则后续步骤跳过
3. 支持双向沟通
4. 最大嵌套深度四层
