---
title: "solo 编排模式"
kind: definition
domain: P2-细胞层
status: stable
tags: [solo, 编排, 单任务]
created: 2026-05-29
updated: 2026-05-29
---

# solo 编排模式

> **定位**：dteam 的组合层。定义 solo 模式的执行逻辑。依赖 worker（P2）。

## 一句话

solo 是 dteam 的**单任务模式**——一个角色执行一个任务，简单高效。

## 适用场景

- 小任务（<100行代码，<3个文件）
- 任务边界清晰
- 不需要多人协作

## 配置示例

```typescript
const config: WorkerConfig = {
  type: "solo",
  task: "探索项目结构",
  style: "pragmatist",
  options: [
    { type: "role", value: "explore" }
  ]
};
```

## 执行流程

```
创建 solo worker
    │
    ▼
加载角色配置（explore/design/build/check/close）
    │
    ▼
执行任务
    │
    ├─ 成功 → 完成
    │
    └─ 失败 → 发送 blocked 信号
        │
        └─ 等待策略
            ├─ retry → 重试
            ├─ adjust → 调整参数
            ├─ switch → 切换方法
            └─ replan → 重新规划
```

## 配置字段

| 字段 | 必填 | 说明 |
|------|------|------|
| type | ✅ | 固定为 "solo" |
| task | ✅ | 任务描述 |
| style | ✅ | 思考方式 |
| role | ✅ | 角色名（explore/design/build/check/close） |

## 不变量

1. solo 必须有 role
2. solo 不能嵌套其他 worker
3. solo 是叶子节点
