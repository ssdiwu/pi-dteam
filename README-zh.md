# pi-dteam

> 轻量级多代理编排系统 — 基于 Pi 的多代理工作流框架

[English](./README.md) | 中文

## 概述

dteam 是一个 **Pi 扩展包**，提供轻量级的多代理编排能力。通过 solo/chain/team 三种模式，在高效与有效之间取得平衡。

## 核心概念

- **task**：工作主语对象（Markdown格式）
- **worker**：执行单元（solo/chain/team三种模式）
- **角色**：6个执行角色（explore/design/build/deploy/check/close）
- **信号**：即时通信机制（4个信号 + 5个策略 = 9种）

## 安装

```bash
# 通过 git 安装（推荐）
pi install git:github.com/ssdiwu/pi-dteam

# 或通过本地路径
pi install /path/to/pi-dteam
```

## 使用

### 命令

```
/explore 任务描述    # 探索者：搜集内部和外部信息
/design 任务描述     # 方案制定者：评估需求、制定方案
/build 任务描述      # 实现者：执行计划、编写代码、更新文档、编写测试
/deploy 任务描述     # 部署者：执行构建、部署上线、验证结果
/check 任务描述      # 验收者：检查代码质量、验证结果
/close 任务描述      # 收口者：整理归档、记录经验、关闭任务
```

### 工具

#### Task 工具

| 工具 | 功能 |
|------|------|
| `task_create` | 创建新的 task |
| `task_read` | 读取 task 的指定 section |
| `task_update` | 更新 task 的指定 section |
| `task_complete` | 标记 checklist 项为完成 |
| `task_archive` | 归档完成的任务 |
| `task_list` | 列出所有 task |
| `task_search` | 搜索 task |

#### Worker 工具

| 工具 | 功能 |
|------|------|
| `worker_create` | 创建 worker 实例 |
| `worker_start` | 启动 worker 执行 |
| `worker_sendSignal` | 发送信号到 worker |
| `worker_cancel` | 取消后台执行的 worker |
| `worker_status` | 获取 worker 状态 |

##### LLM 执行器(自 v0.4.0)

`worker_start` 默认调真实 LLM(走 Pi SDK `createAgentSession`)。执行流程:

1. 加载 `agents/<role>.md` 拿 `systemPrompt` + `tools`(frontmatter)
2. 解析 `model` 优先级:`WorkerConfig.model` → role frontmatter `model` → 当前会话模型(`sessionModel` 兜底)
3. 首选 model 不可用时走 `fallbackModels` 链(超过 5 个截断)
4. 通过 `onUpdate` 流式推送响应,累加 `text_delta` 事件
5. 返回 `{ exitCode, output, usage, model, stopReason, errorMessage, isModelError }`

`executorName: "llm"` 是显式语义入口。默认 executor 自 v0.4.0 起也是真 LLM。

##### Worker 状态 Widget（自 v0.4.1）

worker 运行时在 TUI 中显示 bordered box widget（借鉴 pi-tldr 设计）：

```
╭ worker ── 🔄 running ──────────────────────────────────╮
│ Agent: build                                            │
│ Task: 实现功能                                          │
│ Tools: 3 (current: edit)                                │
│ Elapsed: 5.0s                                           │
╰─────────────────────────────────────────────────────────╯
```

`worker_start` 时自动显示，完成/失败时自动清除。1s 节流更新避免闪烁。

#### Memory 工具

| 工具 | 功能 |
|------|------|
| `memory_get` | 从共享内存获取值 |
| `memory_set` | 向共享内存设置值 |
| `memory_keys` | 列出命名空间下的所有键 |
| `memory_has` | 检查键是否存在 |
| `memory_delete` | 删除键 |
| `memory_clear` | 清空命名空间 |
| `memory_save` | 保存共享内存到文件 |
| `memory_load` | 从文件加载共享内存 |

#### 自适应并发控制

team 模式支持自适应并发控制，根据系统资源（CPU、内存）和任务吞吐动态调节并发度。

**工作模式：**
- **静态模式**：显式传入 `concurrency` 参数，使用固定并发数
- **自适应模式**（默认）：根据系统负载自动调节并发度

**状态机：**
```
coldStart → exploring → steady → overload
    ↑           ↓          ↑        ↓
    └───────────┘          └────────┘
```

**配置选项：**
- `concurrencyMode`: `"static"` | `"adaptive"`（默认 "adaptive"）
- `minConcurrency`: 最小并发数（默认 1）
- `maxConcurrency`: 最大并发数（默认 8）
- `concurrency`: 静态并发数（显式传入时使用静态模式）

**过载保护：**
- CPU > 85% 或内存 < 500MB 时自动降级
- CPU < 70% 且内存 > 1GB 时自动恢复

**示例：**
```json
{
  "type": "team",
  "task": "并行执行多个子任务",
  "style": "explore",
  "options": [
    { "type": "concurrencyMode", "value": "adaptive" },
    { "type": "minConcurrency", "value": 2 },
    { "type": "maxConcurrency", "value": 6 },
    { "type": "workers", "value": [/* workers */] }
  ]
}
```

#### 其他工具

| 工具 | 功能 |
|------|------|
| `reference_architecture` | 查询架构类型参考 |
| `signal_emit` | 发送信号 |
| `signal_history` | 获取信号历史 |

### Compaction 本地化

dteam 内置了 Pi compaction 和 branch summary 输出的本地化功能。这意味着当你使用 `/compact` 或通过 `/tree` 导航分支时，总结的标题会自动翻译成你的语言。

**支持的语言：**

| Locale | 语言 | 标题示例 |
|--------|------|----------|
| `zh-CN` | 简体中文 | `## 目标 / ## 进展 / ## 下一步` |
| `zh-TW` | 繁體中文 | `## 目標 / ## 進展 / ## 下一步` |
| `ja` | 日本語 | `## 目標 / ## 進捗 / ## 次のステップ` |
| `ko` | 한국어 | `## 목표 / ## 진행 상황 / ## 다음 단계` |
| `de` | Deutsch | `## Ziel / ## Fortschritt / ## Nächste Schritte` |
| `fr` | Français | `## Objectif / ## Progression / ## Étapes suivantes` |
| `es` | Español | `## Objetivo / ## Progreso / ## Próximos pasos` |
| `pt` | Português | `## Objetivo / ## Progresso / ## Próximos passos` |
| `ru` | Русский | `## Цель / ## Прогресс / ## Следующие шаги` |
| `ar` | العربية | `## الهدف / ## التقدم / ## الخطوات التالية` |
| `en` | English | `## Goal / ## Progress / ## Next Steps` |

**检查状态：**

```
/compaction-i18n-status
```

语言会从你的环境变量自动检测（`PI_LOCALE` > `LC_ALL` > `LANG`）。

## 开发全流程

```
用户需求
    │
    ▼
/explore → /design → /build → /deploy → /check → /close
（探索）   （设计）   （实现）   （部署）    （验收）   （收口）
```

## 目录结构

```
pi-dteam/
├── package.json        # 扩展包元数据
├── extensions/         # 扩展入口
├── src/                # 源代码
│   ├── P0/             # 原子层：类型、配置、纯函数
│   ├── P1/             # 分子层：服务实现
│   ├── P2/             # 细胞层：编排模式
│   ├── P3/             # 组织层：编排逻辑
│   └── P4/             # 用户接口层：Pi扩展入口
├── agents/             # agent 定义（6个）
├── prompts/            # prompt 模板（6个）
├── reference/          # 参考数据
├── .doc/               # 文档
├── tests/              # 测试
├── AGENTS.md           # Agent 行为规范
└── README.md           # 本文件
```

## 功能特性

### Dteam 调度入口工具

自然语言驱动的 agent 编排。`dteam` 工具让主 LLM 自动选择 agent、组装 worker、决定执行模式。

```typescript
// 列出可用 agent
dteam({ action: "list" })

// 生成执行计划
dteam({ action: "plan", goal: "实现用户登录功能" })

// 执行计划
dteam({ action: "run", goal: "实现用户登录功能" })

// 查询 worker 状态
dteam({ action: "status", workerId: "worker-123" })
```

### 自适应并发控制

基于系统负载的动态并发调整。

```typescript
// 启用自适应模式（默认）
worker_create({ config: { type: "team", concurrencyMode: "adaptive" } })

// 静态模式（旧行为）
worker_create({ config: { type: "team", concurrencyMode: "static", concurrency: 4 } })
```

状态机：`coldStart` → `exploring` → `steady` → `overload`

### 自动编排

从 Markdown 到执行计划的自动任务分解。

```typescript
// 从 task ID 生成计划
dteam({ action: "plan", taskId: "20260601182644-bh4r" })
```

支持 5 种 task 类型：`refactor`、`bugfix`、`infra`、`functional`、`ui`

### Worktree 隔离

并行 worker 的 git worktree 文件级隔离。

```typescript
// 启用 worktree 隔离
worker_create({ config: { type: "team", worktree: true } })

// 完成后自动清理
worker_create({ config: { type: "team", worktree: true, worktreeAutoCleanup: true } })
```

### 全屏进度流

按 `Ctrl+O` 切换 worker 全屏进度视图。

字段：`currentTool`、`recentOutput`、`tokenCount`、`duration`、`activityFreshness`、`currentToolDuration`

## 文档

- [文档导航](.doc/README.md)
- [Agent 行为规范](AGENTS.md)
- [系统注入提示词](reference/系统注入提示词.md)

## 许可证

MIT
