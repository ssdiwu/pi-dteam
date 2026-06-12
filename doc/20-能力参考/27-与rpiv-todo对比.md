# 与 @juicesharp/rpiv-todo 对比

> 调研记录。rpiv-todo 不是 dteam 要集成的 todo（待办）系统；它最值得借的是 **live overlay（实时浮层）状态展示、完成项清理体验、branch replay（分支重放）思路**。

- 来源：[https://pi.dev/packages/@juicesharp/rpiv-todo](https://pi.dev/packages/@juicesharp/rpiv-todo)
- v1.16.1，65.1 KB
- 下载量高，说明“模型可见的任务状态列表”是真实需求

## 1. 一句话

rpiv-todo 是给 LLM 的 todo 列表管理工具：4 状态机 + 依赖追踪 + live overlay UI + 不写盘的 branch replay。dteam 已有任务池和面板，所以**不集成整套**；但 UI 行为值得 0.5 优先借鉴。

## 2. rpiv-todo 核心机制

### 2.1 4 状态机

```text
pending ⇄ in_progress
     ↓
completed
     ↓
deleted (tombstone)
```

### 2.2 live overlay UI

- editor（输入区）上方显示紧凑任务列表
- 完成项保留到下一次 agent response 开始，然后消失
- 行数有限，pending 任务尽量最后截断
- 空时自动隐藏

### 2.3 branch replay

- 不写磁盘
- 状态来自 conversation branch（对话分支）中的工具调用序列
- reload（重载）后通过重放工具调用恢复状态
- 优点：零持久化层、零 schema migration（结构迁移）
- 代价：依赖对话历史完整保留

### 2.4 blockedBy 依赖

每个任务可声明被哪些任务阻塞，并做简单环检测。

## 3. 与 dteam 的关系

| 维度 | rpiv-todo | dteam |
|---|---|---|
| 状态机 | pending / in_progress / completed / deleted | pending / in_progress / done / failed |
| UI | live overlay | `/dteam` widget / panel |
| 依赖 | `blockedBy` | `chain` / `team` 组织形式 |
| 持久化 | branch replay，不写盘 | in-memory（内存） |
| 工具数量 | 1 个 `todo` | 1 个 `dteam` |

结论：功能领域重叠，不集成；UI 行为和轻量恢复思路可借。

## 4. dteam 要借什么

### 4.1 0.5 要借：完成项清理体验

当前 dteam run 完成后会 reset（重置）UI，用户可能来不及看；但如果一直保留，又会堆积。

借鉴方向：

1. worker 完成后先保留在面板中
2. 下一次 agent response 开始或下一次 run 开始时再清理旧完成项
3. 空时自动隐藏 widget
4. 总览优先显示 running / failed / waiting，其次显示 done

### 4.2 0.5 要借：4 状态更清晰

将 UI 状态表达收敛为用户能看懂的 4 类：

| UI 状态 | 来源状态 |
|---|---|
| pending（等待） | `idle` / 未开始 |
| running（进行中） | `running` |
| done（完成） | `done` |
| failed（失败） | `failed` / `error` |

### 4.3 远期参考：branch replay

如果未来要做 persistence + resume，优先评估 branch replay，而不是马上写 `.dteam/sessions/`：

- 先看 Pi 是否能稳定读取当前 conversation branch 的历史 tool call
- 能的话，用工具调用重放恢复 run/task 状态
- 不能的话，再考虑写盘

## 5. 暂不借什么

| 不借 | 原因 |
|---|---|
| 整套 todo 工具 | dteam 已有 `TaskPool` 和 `UIStore` |
| `blockedBy` | dteam 当前用 `chain` / `team` 表达依赖；先不引入第三套模型 |
| deleted tombstone | dteam 不做 todo 审计 |
| i18n（国际化） | dteam 当前中文优先，不引入维护成本 |

## 6. 进入路线图的项

见 `../30-路线图/30-项目路线图.md`：

- 0.5 P0：`/dteam` 面板借鉴 rpiv-todo 完成项清理体验
- 远期：branch replay 作为 persistence + resume 的轻量参考
