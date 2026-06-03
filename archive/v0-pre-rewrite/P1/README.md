# P1 — 分子层

> 依赖 P0，提供服务实现。

## 信息素系统（Signal System）

dteam 的**信息素系统**是 worker 间通信与协调的核心机制，对应蚁群模式中的「信息素」概念。它由三层组成：

```
P0/signal.ts          ← 原子定义（类型）
    ↓
P1/signalBus.ts      ← 进程内实时通信（内存，pub/sub）
P1/signalLog.ts      ← 持久化存储（文件，JSONL + TTL）
    ↓
P2/eventStream.ts    ← 桥接层（bus ↔ log 自动同步）
P4/worker-widget.ts  ← UI 展示（信号角标 📡🚧🔍🆘）
```

### 4 种信号类型

| 类型 | 含义 | 典型场景 | 蚁群映射 |
|------|------|----------|----------|
| `progress` | 正常进度报告 | 任务完成一个步骤、文件修改完毕 | completion 信息素 |
| `blocked` | 遇到阻塞 | 依赖缺失、权限不足、需要人工决策 | warning/repellent 信息素 |
| `found` | 发现重要信息 | 找到关键代码、发现潜在问题 | discovery 信息素 |
| `help` | 需要外部帮助 | 超出能力范围、需要更多上下文 | （蚁群无直接对应） |

### 5 种策略类型

| 策略 | 含义 |
|------|------|
| `retry` | 重试当前操作 |
| `adjust` | 调整参数后继续 |
| `switch` | 切换到备选方案 |
| `replan` | 重新规划执行路径 |
| `learn` | 记录经验供后续参考 |

### 信息素 vs 蚁群 Pheromone 对比

| 维度 | dteam 信号系统 | 蚁群 Pheromone |
|------|-----------------|---------------|
| **数据单元** | `SignalEvent`（TTL + taskId + severity + refs + artifacts） | `Pheromone`（strength + files + type） |
| **存储** | 内存（SignalBus）+ 文件（SignalLog JSONL）双写 | 仅文件（pheromone.jsonl） |
| **衰减** | TTL 软过期（读取时过滤）+ 物理清理 `pruneExpired()` | 半衰期衰减（10 分钟，内存计算） |
| **桥接** | EventStream 自动 bus→log 同步 + view() 合并去重 | 无（单数据源） |
| **归档** | seal() 收口归档到 archive/ | 无（完成即删） |
| **UI** | 信号角标（📡×3）+ Tab 面板 Log 视图 | Ctrl+Shift+A 详情面板 Log 页 |

## 模块清单

| 文件 | 职责 |
|------|------|
| `signalBus.ts` | **信号总线（信息素内存层）**：emit/on/getHistory，进程内实时 pub/sub；所有 worker 共享单例实例 |
| `signalLog.ts` | **信号日志（信息素持久化层）**：POSIX O_APPEND 原子追加 JSONL，单行 4096 字节保护，TTL 软过期，文件滚动 rotate() 和收口归档 seal()，物理清理 pruneExpired() |
| `sharedMemory.ts` | 基础共享内存：namespace 隔离的 key-value 存储 |
| `enhancedSharedMemory.ts` | 增强共享内存：持久化、批量操作、历史追踪、快照 |
| `authService.ts` | 认证服务：注册、登录、token 签发与验证、refresh token |
| `backgroundWorker.ts` | 后台 Worker：不阻塞主进程的异步执行 |
| `spawn.ts` | 子代理运行：调 Pi SDK `createAgentSession` 启子 session 调真 LLM（7 步：auth/registry → model+fallback → resourceLoader → createSession → 订阅事件 → 发 prompt → 返回 result） |
| `worktree.ts` | Git Worktree 隔离：为并行 worker 提供文件级隔离，避免冲突 |
| `i18n.ts` | 国际化翻译表：中英文工具名和状态翻译 |
| `compaction.ts` | 消息压缩：历史消息压缩和摘要 |
| `task.ts` | task CRUD 工具：create/read/update/complete/archive/list/search；`taskCreate()` 默认生成 v2 双层验收模板（`## 验收条件（分两层）` → A 层可校验 + B 层人工裁决） |
| `memory.ts` | 共享内存操作工具：get/set/keys/has/delete/clear/save/load |
| `signal.ts` | 信号操作工具：emit/history |
| `auth.ts` | 认证操作工具：register/login/verify/refresh/logout |

## 依赖关系

```
P1 → P0
```

## 关键设计

- **SignalBus** 是进程内单例，所有 worker 共享同一个实例
- **EnhancedSharedMemory** 是进程内单例，支持 save/load 持久化到 `.dteam/memory/`
- **AuthService** 使用 scrypt 哈希密码、HMAC-SHA256 签名 token
- **spawnAgent**（`spawn.ts`）导出 9 字段 `SpawnOptions`（含 `cwd`/`fallbackModels`/`sessionModel`），走 7 步模式；fallback 链超过 5 个会被截断并 warn；错误分类用 `MODEL_ERROR_PATTERNS` 正则匹配 429/rate limit/auth/timeout；maxRetries=3；传入 `cwd` 时会落盘 `.dteam/spawn/<runId>/input.md` 与 `output.md`/`error.md`