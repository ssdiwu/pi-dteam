# dteam

> A Pi extension: lets Pi gather facts, explore evidence-backed candidate paths, and do mechanical work on cheap small models while your strong model judges and closes — less token, less time.

## What it is

dteam is an extension for [Pi](https://github.com/earendil-works/pi-mono). Once installed, when the main model faces a non-trivial coding task (reading code, gathering facts, exploring technical paths, making changes, running checks), it can dispatch fact-finding, evidence-backed candidate exploration, and mechanical work to cheap, fast small models (T3) and get reports back, escalating to a standard model (T2) or flagship (T1) when stronger capability is needed. **The strong model you're using stays in charge of understanding the task, making decisions, and doing the final review** — it just no longer reads every file or runs every small check itself.

In one line: **small models do the work, the strong model makes the calls.**

## What you'll feel after installing

- The same task, **cheaper and faster**: reading files, gathering facts, exploring evidence-backed candidate paths, and mechanical changes go to cheap models; the strong model's call count and token use drop noticeably.
- The strong model **focuses on what actually needs it**: problem understanding, design decisions, conflict resolution, critical review.
- You **don't pick models by hand**: dteam routes tiers by task need; use `/dteam` to inspect or take over.

## Relationship to dgoal

dteam and [`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) are two independent Pi extensions, orthogonal and composable:

- **dteam**: multi-model tier routing — cheap models do the work, the strong model judges.
- **dgoal**: single-model build-check loop — freeze an acceptance contract for a goal and run independent audits.

Use dteam to save token / time; use dgoal when you need a frozen acceptance contract and independent audit; combine when both apply. See the [trigger protocol](./doc/10-架构与运行/14-dteam触发协议.md) for how to choose.

## Quick start

dteam requires a personal config file; it never guesses tiers from a model name and never silently falls back to the current model.

```bash
# 1. Configure tier models at ~/.pi/agent/pi-dteam.json:
# {
#   "tiers": {
#     "T1": ["openai-codex/gpt-5.6-terra:high"],
#     "T2": ["openai-codex/gpt-5.6-luna:medium"],
#     "T3": ["openai-codex/gpt-5.3-codex-spark:low"]
#   }
# }

# 2. Install into Pi
pi install "$(pwd)"

# 3. /reload in Pi

# 4. Give the main model a non-trivial coding task and watch it dispatch T3 to gather facts
```

If the config is missing or incomplete, dteam warns at startup and refuses to dispatch. Each tier is an ordered candidate array of `provider/model[:thinking]`; later entries are fallbacks.

## Tiers

| Tier | Model | Thinking | Use |
|---|---|---|---|
| **T1 flagship** | flagship model | high | thinking, decisions, critical review, fallback redo |
| **T2 standard** | standard model | medium | regular implementation |
| **T3 fast** | fast / local model | low | mechanical small tasks, fact-finding probes |

- **Read-only by default**; any write must be explicitly authorized via `addTools` at dispatch with a project-relative `writeScope`.
- Each worker has an initial work-tool budget (T3 60 / T2 120 / T1 180); `dteam_signal` and the final `dteam_report` don't count against it.

## The five tools (used by the main model; you usually don't touch them directly)

`dteam_dispatch` (dispatch), `dteam_respond` (respond to worker requests), `dteam_control` (steer, gracefully stop, or force-cancel a running worker), `dteam_recover` (timeout recovery), and `dteam_wait` (wait for a worker event). `dteam_control` needs no `requestId`, does not grant tools or widen `writeScope`, and only targets `running` workers. Its steer/graceful-stop result distinguishes queued, injected, superseded, and expired control; `injected` only means Pi removed the instruction from its queue, never that the worker understood or executed it. `dteam_wait` returns only a bounded, sanitized view: no worker task, full Snapshot, or raw request/event payload enters the tool result. `/dteam` also shows context usage and exact pending-request reply types; press `m` in its modal to edit the global T1/T2/T3 candidate chains, affecting future dispatches only.

## Going deeper

- [Documentation overview](./doc/README.md) — entry to all docs
- [Glossary](./doc/术语表.md)
- [Tool API reference](./doc/10-架构与运行/12-API参考.md)
- [When to use dteam vs dgoal](./doc/10-架构与运行/14-dteam触发协议.md)
- [Project roadmap](./doc/30-路线图/30-项目路线图.md)
- [CHANGELOG](./CHANGELOG.md)

Chinese version: [README-zh.md](./README-zh.md).
