---
title: "spawn 子代理运行"
kind: definition
domain: P1-分子层
status: stable
tags: [spawn, 子代理, 分子层]
created: 2026-05-30
updated: 2026-05-30
---

# spawn 子代理运行

> **定位**：dteam 的分子层。定义 spawn 子代理运行机制。

## 一句话

spawn 是 dteam 的**子代理运行机制**——使用 Pi SDK 创建和运行子代理。

## 核心功能

| 功能 | 说明 |
|------|------|
| 创建子代理 | 使用 Pi SDK createAgentSession |
| 会话管理 | 管理子代理的生命周期 |
| token流 | 实时获取子代理的输出 |
| 认证/模型 | 共享认证和模型 |

## 接口定义

```typescript
interface SpawnOptions {
  systemPrompt: string;  // 系统提示
  task: string;          // 任务
  model?: string;        // 模型
  tools?: string[];      // 工具
  signal?: AbortSignal;  // 中止信号
  onUpdate?: (partial: { output: string }) => void;  // 更新回调
}

interface SpawnResult {
  exitCode: number;  // 退出码
  output: string;    // 输出
  error?: string;    // 错误信息
}
```

## 使用示例

```typescript
import { spawnAgent } from "../P1/spawn.js";

// 创建子代理并执行任务
const result = await spawnAgent({
  systemPrompt: "你是一个探索者角色",
  task: "探索项目结构",
  model: "anthropic/claude-3-5-sonnet",
  tools: ["read", "bash", "edit", "write"],
  onUpdate: ({ output }) => {
    console.log("输出:", output);
  },
});

console.log("结果:", result.output);
console.log("退出码:", result.exitCode);
```

## 与其他机制的关系

| 机制 | 作用 | 说明 |
|------|------|------|
| spawn | 运行子代理 | Pi SDK createAgentSession |
| 共享内存 | 数据共享 | 多个worker之间传递数据 |
| 信号总线 | 即时通信 | 多个worker之间传递信号 |
| 上下文构建器 | 上下文注入 | 构建完整执行上下文 |

## 工作流程

```
1. 构建上下文 (上下文构建器)
   │
   ▼
2. 创建子代理 (spawn)
   │
   ├─ 注入上下文 (systemPrompt)
   ├─ 共享内存 (数据共享)
   └─ 信号总线 (即时通信)
   │
   ▼
3. 子代理执行任务
   │
   ├─ 读取共享内存
   ├─ 写入共享内存
   ├─ 发送信号
   └─ 接收信号
   │
   ▼
4. 完成任务
   │
   ▼
5. 返回结果
```

## 文件位置

- 代码：`src/P1/spawn.ts`
