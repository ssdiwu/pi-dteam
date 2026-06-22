# dteam

> **A goal-driven, self-growing multi-worker collaboration extension for Pi — collective intelligence via a summon pool.**

>
> Simple tasks are handled directly by the main LLM. When a task needs **collective intelligence** (summoning multiple specialized roles to collaborate), dteam enters a synchronous foreground **Orchestrator Loop**.
>
> 0.6.0 redefinition landed: dteam is now a goal-driven self-growing summon pool with a synchronous foreground Orchestrator Loop (no longer a background two-dimensional orchestration engine). The old `solo/chain/team` engine, `planner`/`pool`/`scheduler` and 0.5.0 orchestration types have been removed. See [`doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md`](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md) for the 18 fundamental decisions.

**Sister project**: [`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) — independent and parallel. **dteam = collective intelligence (summon pool); dgoal = build-check loop (single-agent + independent audit).** The main LLM chooses which to use; they are not merged, not auto-switched. Chinese version: [`README-zh.md`](./README-zh.md).

## TL;DR

dteam grows out of a goal. When the main LLM hits a task that needs collective intelligence, it summons fixed-role workers on demand: `explore` / `design` / `build` / `check` / `close`.

- **Synchronous foreground Orchestrator Loop** — no longer background; the loop blocks the main conversation until `check` closes out.
- **In-process `AgentSession` workers + Logical Isolation** — not OS subprocesses by default.
- **Signal Store (TTL decay)** — workers emit `progress / found / blocked / help` via `session.subscribe`; the Orchestrator reads the store each loop turn.
- **LLM-Driven Orchestration** — one LLM call per loop turn decides whom to summon next.
- **Adaptive Concurrency + Multi-Provider Routing** — multiple workers in flight, with per-role model + fallback chains to avoid single-provider rate walls.
- **Completion Gate** — the Orchestrator cannot self-terminate; every goal must pass a `check` summon to count as done.
- **Fixed five roles** — no role marketplace; `build` is the only role that can `edit` existing files.

## Current state (0.6.0)

The `src/` codebase has been rewritten to the 0.6.0 summon-pool shape: synchronous foreground `runLoop`, in-process `AgentSession` workers with Logical Isolation, Signal Store with TTL decay, Adaptive Concurrency + Multi-Provider Routing, and a mandatory `check` completion gate. The 0.5.0 background `run`/`runId` engine, `planner`/`pool`/`scheduler`, and two-dimensional orchestration types have been removed.

**Output contract (tool calling)**: Orchestrator decisions and `check` completion conclusions use Pi tool calling (`orchestrator_decide` / `check_conclude` customTools) — LLM calls the tool for structured output, runLoop reads from a receiver. This replaces the fragile free-text JSON parsing and keyword-guessing (see `doc/40-版本实施方案/43-v0.6.0-真实运行探测报告.md`).

**Verified end-to-end**: `glm-5.2` runs a full goal → `check` completion gate → `status=done` (see `doc/40-版本实施方案/smoke-logs/glm-5.2-end-to-end-done.log`).

- [ADR 0005 — 0.6.0 redefine as self-growing summon pool](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md) — the 18 decisions.
- [0.6.0 summon-pool redefinition implementation plan](./doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md) — end-to-end verified (2026-06-22).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Run tests
npm test

# 4. Install into Pi
pi install "$(pwd)"

# 5. Run /reload in Pi

# 6. Invoke dteam (0.6.0 synchronous foreground Orchestrator Loop)
# /dteam <goal>          (user explicit)
# dteam(goal="...")      (main LLM auto)
# action=run blocks the main conversation until check gate closes.

# 7. /dteam command
# Type /dteam in Pi to open the live progress panel
```

## Four signals

Workers report four signal types into the Signal Store:

| Signal | When | Orchestrator behavior |
|------|--------|---------|
| **progress** | Completed an action / step | Update Signal Store; influences next summon decision |
| **found** | Discovered unplanned information | Write to store; may trigger peer forwarding |
| **blocked** | Stopped / failed | Orchestrator summons `explore` to self-heal, or switches role |
| **help** | Cannot resolve itself | 1st time: summon `explore` to collect supplements<br>2nd time: escalate to human |

## When to use dteam vs dgoal

One-line rule: **simple tasks are done directly by the main LLM; single-agent推进 + independent audit uses dgoal; collective intelligence (summoning multiple specialized roles) uses dteam; explicit user requests are respected.**

| Judgment | Use |
|---|---|
| Single agent can do it, self-推进 | Main LLM directly |
| Single-agent推进 + needs independent zero-context audit | **dgoal** (build-check loop) |
| Needs multiple specialized roles to collaborate (explore/design/build/check/close) | **dteam** (collective intelligence) |
| User explicitly says "use dteam" | **dteam** |
| User explicitly says "use dgoal / /dgoal" | **dgoal** |

Full protocol: see [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md).

## Documentation

> The repo has 3 layers: `index.ts` + `src/` + `agents/` is the runtime core, `tests/` is verification, `doc/` is current docs. When refactoring, modify runtime core and current docs first.

- [Documentation overview](./doc/README.md)
- [ADR 0005 — 0.6.0 summon-pool redefinition (current skeleton authority)](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md)
- [Glossary](./doc/术语表.md)
- [System architecture (Orchestrator Loop + Signal Store)](./doc/10-架构与运行/10-系统架构.md)
- [Role system (fixed 5 roles, check = Completion Gate)](./doc/10-架构与运行/11-角色系统.md)
- [Tool API reference (synchronous foreground execution)](./doc/10-架构与运行/12-API参考.md)
- [v2 design and current status (two-dimensional orchestration superseded by 0.6.0)](./doc/10-架构与运行/13-设计-v2与实施现状.md)
- [dteam trigger protocol (dteam vs dgoal)](./doc/10-架构与运行/14-dteam触发协议.md)
- [Project roadmap](./doc/30-路线图/30-项目路线图.md)
- [0.6.0 summon-pool redefinition implementation plan](./doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md)
- [0.5.0 lightweight dependency-graph scheduling plan (archived)](./doc/90-归档/版本实施方案/41-v0.5.0-轻量依赖图调度与运行态UI实施方案.md)
- [Multi-worker orchestration system reference](./doc/20-能力参考/22-多worker编排系统参考.md)
- [src/ internal architecture](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [中文 README](./README-zh.md)

## Directory layout

```
.
├── index.ts                 # Pi extension entry (registers dteam tool + /dteam command)
├── src/
│   ├── orchestrator-loop.ts     # 0.6.0 Orchestrator Loop main (LLM-driven per-turn decision)
│   ├── orchestrator-loop/       # decision.ts / check-gate.ts / concurrency.ts / model-routing.ts
│   ├── leaf.ts             # Worker execution layer (in-process AgentSession + Logical Isolation)
│   ├── session.ts          # createWorkerSession factory (logicalIsolation + onSession)
│   ├── tools.ts            # Type hub (0.6.0 pure re-export; orchestration types in types/loop.ts)
│   ├── reference-data.ts   # reference_architecture tool (12 patterns + ADR template)
│   ├── reporter.ts         # Reporter interface
│   ├── config.ts           # DTEAM_CONFIG centralized constants
│   ├── signals/            # 0.6.0 target: Signal Store (TTL decay)
│   ├── types/              # Extracted types
│   ├── scheduler/          # 0.5.0 file graph + preflight (0.6.0: demoted to auxiliary signal)
│   ├── ui/                 # UI module (store / panel / helpers)
│   ├── session/            # session.ts split (role-config / role-prompt / model-resolver / ...)
│   ├── leaf/               # leaf.ts split
│   └── orchestrator/       # orchestrator.ts split (signal-handlers / strategies / ...)
├── agents/                 # 5 role definitions (explore / design / build / check / close)
├── tests/                  # test files
└── doc/                    # All docs (Chinese filenames); adr/ holds decision records
```

## Design philosophy (0.6.0)

- **Goal-driven self-growth**: tasks emerge from execution, not from a pre-enumerated plan; the summon trail *is* the plan.
- **Collective intelligence, not pipeline**: five fixed roles summoned on demand by the Orchestrator, not fixed stages.
- **Synchronous foreground Orchestrator Loop**: real-time signal reading, dynamic decisions; trades non-blocking for real-time coordination.
- **In-process workers + Logical Isolation**: `SessionManager.inMemory()` + minimal ResourceLoader + tool whitelist, instead of OS subprocess isolation.
- **Signal Store with TTL decay**: reuses the existing signal mechanism; temporary, per-goal, never lands in the project directory.
- **Adaptive Concurrency + Multi-Provider Routing**: throughput without hitting single-provider rate walls.
- **Completion Gate**: mandatory `check` closeout; the Orchestrator cannot self-terminate.
- **Parallel to dgoal**: collective intelligence (dteam) vs build-check loop (dgoal), independent, not merged.

## Verification status

- ✅ 0.6.0 code landed (Orchestrator Loop + Signal Store + Logical Isolation + Adaptive Concurrency + Multi-Provider Routing + Completion Gate)
- ✅ 0.5.0 orchestration code removed (orchestrator.ts / planner.ts / pool.ts / scheduler/ / two-dimensional types)
- ✅ `npm run build` passes; `npm test` green (140 unit tests; vi.mock verifies decision flow / concurrency / routing)
- ⏳ End-to-end real-LLM run (`/dteam <goal>`) needs manual verification in a Pi environment with API key

## Related links

- Pi extension development: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- Sister project pi-dgoal: <https://github.com/ssdiwu/pi-dgoal>
