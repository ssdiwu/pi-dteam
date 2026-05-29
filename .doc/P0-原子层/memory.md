---
title: "内存定义"
kind: definition
domain: P0-原子层
status: stable
tags: [内存, 原子层]
created: 2026-05-29
updated: 2026-05-29
---

# 内存定义

> **定位**：dteam 的原子层。定义内存条目结构，用于共享内存。

## 一句话

内存条目是共享内存的**基本单元**——存储键值对及其元数据。

## 接口定义

```typescript
interface MemoryEntry {
  key: string;           // 键名
  value: unknown;        // 值
  createdAt: number;     // 创建时间
  updatedAt: number;     // 更新时间
  createdBy: string;     // 创建者ID
}
```

## 使用场景

- worker 之间共享数据
- 存储中间结果
- 缓存计算结果

## 文件位置

- 代码：`src/P0/memory.ts`
- 测试：`tests/unit/P0.test.ts`
