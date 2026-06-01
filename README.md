# pi-dteam

> Lightweight multi-agent orchestration system — a multi-agent workflow framework for Pi

English | [中文](./README-zh.md)

## Overview

dteam is a **Pi extension package** that provides lightweight multi-agent orchestration capabilities. It balances efficiency and effectiveness through three modes: solo, chain, and team.

## Core Concepts

- **Task**: Work unit object (Markdown format)
- **Worker**: Execution unit (solo/chain/team modes)
- **Roles**: 5 execution roles (explore/design/build/check/close)
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
/explore → /design → /build → /check → /close
 (explore)  (design)  (build)  (review)  (close)
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
├── agents/             # Agent definitions (5)
├── prompts/            # Prompt templates (5)
├── reference/          # Reference data
├── .doc/               # Documentation
├── tests/              # Tests
├── AGENTS.md           # Agent behavior specification
└── README.md           # This file
```

## Documentation

- [Documentation Navigation](.doc/README.md)
- [Agent Behavior Specification](AGENTS.md)
- [System Injection Prompt](reference/系统注入提示词.md)

## License

MIT
