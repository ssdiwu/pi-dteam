# pi-dteam

> Lightweight multi-agent orchestration system — a multi-agent workflow framework for Pi

English | [中文](./README-zh.md)

## Overview

dteam is a **Pi extension package** that provides lightweight multi-agent orchestration capabilities. It balances efficiency and effectiveness through three modes: solo, chain, and team.

## Core Concepts

- **Task**: Work unit object (Markdown format)
- **Worker**: Execution unit (solo/chain/team modes)
- **Roles**: 6 execution roles (explore/design/build/deploy/check/close)
- **Signals**: Real-time communication mechanism (4 signals + 5 strategies = 9 types)

## Installation

```bash
# Install via git (recommended)
pi install git:github.com/ssdiwu/pi-dteam

# Or via local path
pi install /path/to/pi-dteam
```

## Usage

### Commands

```
/explore task description    # Explorer: gather internal and external information
/design task description     # Designer: evaluate requirements, create plans
/build task description      # Builder: execute plans, write code, update docs, write tests
/deploy task description     # Deployer: build, deploy, and verify releases
/check task description      # Reviewer: check code quality, verify results
/close task description      # Closer: organize, archive, record lessons, close tasks
```

### Tools

#### Task Tools

| Tool | Description |
|------|-------------|
| `task_create` | Create a new task |
| `task_read` | Read a specific section of a task |
| `task_update` | Update a specific section of a task |
| `task_complete` | Mark a checklist item as completed |
| `task_archive` | Archive a completed task |
| `task_list` | List all tasks |
| `task_search` | Search tasks |

#### Worker Tools

| Tool | Description |
|------|-------------|
| `worker_create` | Create a worker instance |
| `worker_start` | Start worker execution |
| `worker_sendSignal` | Send a signal to a worker |
| `worker_cancel` | Cancel a background worker |
| `worker_status` | Get worker status |

#### Dteam Scheduler Tool

| Tool | Description |
|------|-------------|
| `dteam` | dteam 调度入口，支持 list/plan/run/status 4 个 action |

**Action 说明：**

| Action | 说明 | 输入 | 输出 |
|--------|------|------|------|
| `list` | 列出所有角色 | 无 | 角色列表（name, description, tools） |
| `plan` | 生成执行计划 | goal, agents?, mode? | 执行计划（mode, steps, 角色串接方式） |
| `run` | 创建 worker 并后台启动 | goal, agents?, mode?, style? | workerId, plan |
| `status` | 查询 worker 状态 | workerId | worker 运行状态 |

**执行模式：**
- **solo**：单角色执行（1 个 agent）
- **chain**：串行执行（多 agent，按顺序）
- **team**：并行执行（多 agent，同时进行）

**默认链：** explore → design → build → check → close

##### LLM Executor (since v0.4.0)

By default, `worker_start` calls real LLM via Pi SDK (`createAgentSession`). The worker:

1. Loads `agents/<role>.md` for `systemPrompt` + `tools` (frontmatter)
2. Resolves `model` from (in priority order): `WorkerConfig.model` → role frontmatter `model` → user current session model (`sessionModel` fallback)
3. Walks `fallbackModels` chain if primary model is unavailable (truncated to 5)
4. Streams responses via `onUpdate`; accumulates `text_delta` events
5. Returns `{ exitCode, output, usage, model, stopReason, errorMessage, isModelError }`

Pass `executorName: "llm"` to `worker_start` to explicitly opt into LLM execution. Without it, the same default behavior applies (default executor is now real LLM, not mock).

##### Worker Status Widget (since v0.4.1)

A bordered box widget shown in TUI while worker is running (inspired by pi-tldr):

```
╭ worker ── 🔄 running ──────────────────────────────────╮
│ Agent: build                                            │
│ Task: Implement feature                                 │
│ Tools: 3 (current: edit)                                │
│ Elapsed: 5.0s                                           │
╰─────────────────────────────────────────────────────────╯
```

Automatically shown on `worker_start` and cleared on completion/failure. Throttled at 1s intervals to avoid flicker.

#### Memory Tools

| Tool | Description |
|------|-------------|
| `memory_get` | Get a value from shared memory |
| `memory_set` | Set a value in shared memory |
| `memory_keys` | List all keys in a namespace |
| `memory_has` | Check if a key exists |
| `memory_delete` | Delete a key |
| `memory_clear` | Clear a namespace |
| `memory_save` | Save shared memory to a file |
| `memory_load` | Load shared memory from a file |

#### Adaptive Concurrency Control

The team mode supports adaptive concurrency control, which dynamically adjusts concurrency based on system resources (CPU, memory) and task throughput.

**Modes:**
- **Static mode**: Explicitly pass `concurrency` parameter to use a fixed concurrency
- **Adaptive mode** (default): Automatically adjusts concurrency based on system load

**State Machine:**
```
coldStart → exploring → steady → overload
    ↑           ↓          ↑        ↓
    └───────────┘          └────────┘
```

**Configuration Options:**
- `concurrencyMode`: `"static"` | `"adaptive"` (default "adaptive")
- `minConcurrency`: Minimum concurrency (default 1)
- `maxConcurrency`: Maximum concurrency (default 8)
- `concurrency`: Static concurrency (uses static mode when explicitly passed)

**Overload Protection:**
- Auto-degrades when CPU > 85% or memory < 500MB
- Auto-recovers when CPU < 70% and memory > 1GB

**Example:**
```json
{
  "type": "team",
  "task": "Run multiple subtasks in parallel",
  "style": "explore",
  "options": [
    { "type": "concurrencyMode", "value": "adaptive" },
    { "type": "minConcurrency", "value": 2 },
    { "type": "maxConcurrency", "value": 6 },
    { "type": "workers", "value": [/* workers */] }
  ]
}
```

#### Other Tools

| Tool | Description |
|------|-------------|
| `reference_architecture` | Query architecture type references |
| `signal_emit` | Emit a signal |
| `signal_history` | Get signal history |

### Compaction I18n

dteam includes built-in localization for Pi's compaction and branch summary outputs. This means when you use `/compact` or navigate branches with `/tree`, the summary headings will be automatically localized to your language.

**Supported Languages:**

| Locale | Language | Headings Example |
|--------|----------|------------------|
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

**Check Status:**

```
/compaction-i18n-status
```

The language is auto-detected from your environment (`PI_LOCALE` > `LC_ALL` > `LANG`).

## Full Workflow

```
User Requirement
       │
       ▼
/explore → /design → /build → /deploy → /check → /close
 (explore)  (design)  (build)  (deploy)   (review)  (close)
```

## Directory Structure

```
pi-dteam/
├── package.json        # Package metadata
├── extensions/         # Extension entry point
├── src/                # Source code
│   ├── P0/             # Atomic layer: types, config, pure functions
│   ├── P1/             # Molecular layer: service implementations
│   ├── P2/             # Cellular layer: orchestration patterns
│   ├── P3/             # Organizational layer: orchestration logic
│   └── P4/             # User interface layer: Pi extension entry
├── agents/             # Agent definitions (6)
├── prompts/            # Prompt templates (6)
├── reference/          # Reference data
├── .doc/               # Documentation
├── tests/              # Tests
├── AGENTS.md           # Agent behavior specification
└── README.md           # This file
```

## Features

### Dteam Scheduler Tool

Natural language driven agent orchestration. The `dteam` tool lets the main LLM automatically select agents, assemble workers, and decide execution mode.

```typescript
// List available agents
dteam({ action: "list" })

// Generate execution plan
dteam({ action: "plan", goal: "Implement user login" })

// Execute plan
dteam({ action: "run", goal: "Implement user login" })

// Query worker status
dteam({ action: "status", workerId: "worker-123" })
```

### Adaptive Concurrency Control

Dynamic concurrency adjustment based on system load.

```typescript
// Enable adaptive mode (default)
worker_create({ config: { type: "team", concurrencyMode: "adaptive" } })

// Static mode (legacy behavior)
worker_create({ config: { type: "team", concurrencyMode: "static", concurrency: 4 } })
```

States: `coldStart` → `exploring` → `steady` → `overload`

### Chain Planner

Automatic task decomposition from Markdown to execution plan.

```typescript
// Generate plan from task ID
dteam({ action: "plan", taskId: "20260601182644-bh4r" })
```

Supports 5 task types: `refactor`, `bugfix`, `infra`, `functional`, `ui`

### Worktree Isolation

Git worktree isolation for parallel workers.

```typescript
// Enable worktree isolation
worker_create({ config: { type: "team", worktree: true } })

// Auto-cleanup on completion
worker_create({ config: { type: "team", worktree: true, worktreeAutoCleanup: true } })
```

### Full-screen Progress View

Press `Ctrl+O` to toggle full-screen progress view for workers.

Fields: `currentTool`, `recentOutput`, `tokenCount`, `duration`, `activityFreshness`, `currentToolDuration`

## Documentation

- [Documentation Navigation](.doc/README.md)
- [Agent Behavior Specification](AGENTS.md)
- [System Injection Prompt](reference/系统注入提示词.md)

## License

MIT
