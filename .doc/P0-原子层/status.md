---
title: "状态定义"
kind: definition
domain: P0-原子层
status: stable
tags: [状态, 原子层]
created: 2026-05-29
updated: 2026-05-29
---

# 状态定义

> **定位**：dteam 的原子层。定义 worker 状态。

## 一句话

状态是 worker 的**生命周期**——4 个状态：pending / running / done / failed。

## 状态类型

| 状态 | 说明 |
|------|------|
| `pending` | 准备中 |
| `running` | 运行中 |
| `done` | 完成 |
| `failed` | 失败 |

## 接口定义

```typescript
type WorkerStatus = "pending" | "running" | "done" | "failed";
```

## 状态流转

```
pending → running → done
              ↓
           failed
```

## 文件位置

- 代码：`src/P0/status.ts`
- 测试：`tests/unit/P0.test.ts`
