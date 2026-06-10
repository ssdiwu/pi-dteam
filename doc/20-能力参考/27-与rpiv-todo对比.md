# 与 @juicesharp/rpiv-todo 对比

> 调研记录。本节只做范式对比和"轻 / 重"评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](../30-路线图/30-项目路线图.md)**。

- 来源：[https://pi.dev/packages/@juicesharp/rpiv-todo](https://pi.dev/packages/@juicesharp/rpiv-todo)
- v1.16.1，**65.1 KB**（这批调研里最轻）
- **41.1K 下载/月**（这批调研里下载量最大）
- 作者：juicesharp
- 借鉴参考：ant-colony

## 一句话

rpiv-todo 是个**给 LLM 的 todo 列表管理工具**：4 状态机 + 跨 session 持久化（**不写盘**）+ 依赖追踪 + live overlay UI。下载量很大（41.1K/月），说明"模型 todo 列表"是真实需求。

## 核心机制

### 4 状态机

```
pending ⇄ in_progress
     ↓
completed
     ↓
deleted (tombstone，审计)
```

`deleted` 保留为 tombstone，让 historic `blockedBy` 引用仍能 resolve。

### 持久化：branch replay（不写盘）

- **不写磁盘**——任务状态**靠 in-conversation 重放恢复**
- 工具调用序列存在 conversation branch 里
- `/reload` 或 Pi compaction 后，从 conversation branch 重新 replay 工具调用，恢复任务状态
- 优点：零持久化层、零写盘、零冲突、零版本兼容
- 限制：任务状态依赖 conversation 完整保留

### blockedBy 依赖追踪

- 每个 task 可以声明 `blockedBy: number[]`（被哪些 task 阻塞）
- 简单的环检测算法（拓扑排序）
- 让模型能"声明依赖"而不是"靠 chain 模式串行"

### Live overlay UI

- editor 上方的小 widget
- 完成项保留到下次 agent response 开始，然后消失
- 12 行截断阈值；pending 任务最晚被截断
- 空时自动隐藏

### 工具 schema

```
todo({
  action: "create" | "update" | "list" | "get" | "delete" | "clear",
  subject?: string,
  blockedBy?: number[],
  description?: string,
  status?: "pending" | "in_progress" | "completed" | "deleted",
  ...
})
```

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> **轻**：branch replay 思路（设计模式）
> **中**：blockedBy 依赖追踪（引入新概念）
> **重**：—
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。

## 与 dteam 的关系

dteam 已经有 `src/pool.ts`，是 4 态任务池。**和 rpiv-todo 几乎重叠**。

| 维度 | rpiv-todo | dteam `pool.ts` |
|------|----------|----------------|
| 4 状态机 | ✅ pending/in_progress/completed/deleted | ✅ pending/in_progress/done/failed |
| 依赖追踪 | ✅ blockedBy + 环检测 | ⚠️ chain 模式（线性）/ team 模式（并行） |
| 持久化 | ✅ branch replay（不写盘） | ❌ in-memory |
| Live overlay UI | ✅ | ✅ `src/ui/panel.ts` |
| 工具暴露 | 1 个 `todo` 工具 | 1 个 `dteam` 工具 |
| i18n | ✅（可选 SDK） | ❌（中文为主） |

**整体集成是重叠**——dteam 自己的 `pool.ts` 已经覆盖了 4 状态 + UI。**整套不集成**。

## 借鉴清单

| 项 | 范围 | 状态 | 备注 |
|----|------|------|------|
| **branch replay 持久化思路** | 远期参考 | 仅参考 | dteam "persistence + resume" 远期项的轻量级实现参考（**不写盘，靠 in-conversation replay**） |
| blockedBy 依赖追踪 | — | 暂不做 | dteam 当前 chain/team 已覆盖，引入是新概念 |
| 整套集成 | — | 不做 | dteam `pool.ts` 已覆盖 4 状态 + UI |

## 重点：branch replay 思路详解

dteam "persistence + resume" 在 [项目路线图.md](../30-路线图/30-项目路线图.md) 的"远期规划"段，设想是：

- 写盘 + 序列化 `SessionManager` + resume 检测
- **重**：要写盘格式、版本兼容、resume 检测逻辑

rpiv-todo 给的轻量级思路：

- **不写盘**——靠 in-conversation 重放工具调用恢复状态
- **轻**：零持久化层、零写盘、零冲突

如果未来 dteam 重做"persistence + resume"，应该按这个轻量级思路。

**不写盘的代价**：任务状态依赖 conversation 完整保留（不能截断太狠）。dteam 当前 `compaction: { enabled: false }`，不主动压缩，所以这点没问题。

## 不要学

- ❌ 整套集成（dteam 已有 `pool.ts`，重叠）
- ❌ i18n（dteam 中文为主，不引入复杂度）
- ❌ deleted tombstone（dteam 不做审计）
- ❌ live overlay UI（dteam 已有 `src/ui/panel.ts`）

## 关键不变量（dteam 必须保留）

1. **`src/pool.ts` 4 状态机**（pending/in_progress/done/failed）—— 不替换
2. **chain 模式 + team 模式**（不引入 blockedBy）
3. **`src/ui/panel.ts` 单 UI 层**（不增加 overlay）
4. **`compaction: { enabled: false }`**（不主动压缩 context）
5. **单一 `dteam` 工具**（不增加 `todo` 工具）

## 参考实现位置

- npm 包：`@juicesharp/rpiv-todo`
- 关键文件：`./index.ts`（单文件扩展）
- **branch replay 实现**：见 `index.ts` 里的"branch replay"逻辑（conversation branch 重新执行工具调用恢复状态）
- 4 状态机：见状态转换函数
- blockedBy 环检测：见拓扑排序逻辑
