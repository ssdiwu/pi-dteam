---
title: "信号定义"
kind: definition
domain: P0-原子层
status: stable
tags: [信号, 原子层]
created: 2026-05-29
updated: 2026-05-29
---

# 信号定义

> **定位**：dteam 的原子层。定义信号类型，用于 worker 之间的即时通信。

## 一句话

信号是 worker 之间的**即时通信机制**——4 个信号 + 5 个策略 = 9 种信号类型。

## 信号类型

| 类别 | 信号 | 说明 |
|------|------|------|
| 状态报告 | `progress` | 报告当前进度 |
| 状态报告 | `blocked` | 遇到阻塞 |
| 状态报告 | `found` | 发现信息 |
| 协调请求 | `help` | 请求外部帮助 |

## 策略类型

| 类别 | 策略 | 说明 |
|------|------|------|
| 恢复策略 | `retry` | 重试当前操作 |
| 恢复策略 | `adjust` | 调整参数后重试 |
| 恢复策略 | `switch` | 切换到其他工具/方法 |
| 规划策略 | `replan` | 重新规划任务 |
| 学习策略 | `learn` | 记录经验教训 |

## 接口定义

```typescript
type SignalType = "progress" | "blocked" | "found" | "help";
type StrategyType = "retry" | "adjust" | "switch" | "replan" | "learn";

interface Signal {
  id: string;           // signal-{timestamp}-{random4}
  type: SignalType;     // 信号类型
  workerId: string;     // 发送者ID
  timestamp: number;    // 时间戳
  data: Record<string, unknown>;  // 附加数据
}

interface Strategy {
  type: StrategyType;
  description: string;
  params?: Record<string, unknown>;
}
```

## 文件位置

- 代码：`src/P0/signal.ts`
- 测试：`tests/unit/P0.test.ts`
