---
title: "TUI 渲染层"
kind: definition
domain: P1-分子层
status: stable
tags: [TUI, 渲染, 分子层]
created: 2026-05-29
updated: 2026-05-29
---

# TUI 渲染层

> **定位**：dteam 的分子层。定义 TUI 渲染层，用于实时显示 worker 进度。

## 一句话

TUI 渲染层是 dteam 的**可视化中枢**——实时显示 worker 状态和进度。

## 核心功能

| 功能 | 说明 |
|------|------|
| L1 renderCall | 工具调用时展示 |
| L2 renderResult | 工具返回时展示 |
| L3 registerMessageRenderer | worker 实时进度消息（最多3行） |
| session_start | 底部状态栏（worker 状态） |

## 接口定义

```typescript
// 注册渲染器
function registerRenderers(pi: ExtensionAPI): void;

// 发送 worker 进度消息
function emitWorkerProgress(
  pi: ExtensionAPI,
  workerId: string,
  status: "pending" | "running" | "done" | "failed",
  task: string,
): void;
```

## 消息格式

```
[DTEAM_PROGRESS] <workerId> <status> <task>
```

## 显示效果

```
✓ worker-0 [done] 探索项目结构
● worker-1 [running] 设计方案
○ worker-2 [pending] 实现代码
```

## 底部状态栏

```
✓ worker-0: 探索项目结构 | ● worker-1: 设计方案 | ○ worker-2: 实现代码
```

## 使用示例

```typescript
// 在工具执行中发送进度消息
emitWorkerProgress(pi, "worker-0", "running", "探索项目结构");

// 完成后发送完成消息
emitWorkerProgress(pi, "worker-0", "done", "探索项目结构");
```

## 文件位置

- 代码：`src/extension/renderers.ts`
