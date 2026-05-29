---
title: "配置定义"
kind: definition
domain: P0-原子层
status: stable
tags: [配置, 原子层]
created: 2026-05-29
updated: 2026-05-29
---

# 配置定义

> **定位**：dteam 的原子层。定义 WorkerConfig 配置结构。

## 一句话

WorkerConfig 是 worker 的**统一配置**——通过 options 数组承接所有可选配置。

## 接口定义

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
  | { type: "maxDepth"; value: number }
  | { type: "debug"; value: boolean };
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
| debug | ⚪ 可选 | ⚪ 可选 | ⚪ 可选 | 调试模式 |

## 辅助函数

```typescript
// 从 options 中获取指定类型的值
function getOption<T>(options: WorkerOption[] | undefined, type: string): T | undefined;

// 从 options 中获取指定类型的值（必填）
function getRequiredOption<T>(options: WorkerOption[] | undefined, type: string): T;
```

## 文件位置

- 代码：`src/P0/config.ts`
- 测试：`tests/unit/P0.test.ts`
