# dteam

> **A model-tier routing execution layer and evidence-driven main-agent protocol for Pi — small models gather facts and do mechanical work; the strong model decides.**

The main model acts as owner: it defines the current evidence question, dispatches complementary T3 probes in bounded rounds, synthesizes reports, and decides whether to close, fetch more, implement, verify, or explicitly escalate T3 → T2 → T1. Worker Manager executes already-dispatched workers; it does not own rounds, dependencies, or the next task.

**Sister project**: [`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) — independent and parallel. **dteam = model-tier routing and fresh-context execution; dgoal = three-Plan planning assurance and build-check loops.** The two mechanisms are orthogonal and composable; they are not merged or auto-switched. Chinese version: [`README-zh.md`](./README-zh.md).

> **Current implementation**: ADR 0013–0021 are implemented: four public tools, bounded handoff, incremental-cost execution, interrupted-write integrity guards, human-readable projections, the evidence-driven main-agent protocol, and a unified WorkerReport that separates task outcome, actual activities, facts, and verification. `/dteam` remains the user management entry.

## TL;DR

dteam exists because **using a strong model for small tasks is a double waste** (expensive + slow). Its value is model-tier routing plus fresh context isolation — execution concerns that dgoal's Plan and independent-audit model does not provide.

- **Evidence-driven rounds** — for non-trivial repository work, the main agent starts with bounded, complementary T3 probes and dispatches another round only for concrete gaps exposed by synthesis.
- **Four tools** — `dteam_dispatch`, `dteam_respond`, `dteam_recover`, and explicit dependency wait `dteam_wait`; `/dteam` remains the user management command.
- **Unified WorkerReport** — `outcome`, actual `activities`, sourced `facts`, and actual `verification` stay distinct; Manager `completed` does not imply the task or verification passed.
- **T1 / T2 / T3 model tiers** (replace the old five roles) — anchored to vendor product lines (flagship / standard / fast).
- **Thinking follows tier** — T1 high / T2 medium / T3 low; the main model escalates only after it synthesizes lower-tier evidence, rather than making a small model think longer.
- **Fresh review (optional)** — dispatch creates isolated in-process `AgentSession` workers; the main model explicitly requests a T1 read-only review only for critical work, countering its "grade your own homework" bias.
- **Recovery and escalation** — same-tier model candidates auto-fallback for availability; cross-tier escalation is explicitly decided by the main model (T3 → T2 → T1).
- **Adaptive Concurrency + Multi-Provider Routing** — multiple workers in flight, per-tier model + fallback chains.

## Model tiers (T1/T2/T3)

| Tier | Model | Thinking | Default tools | Initial work-tool budget | Use |
|---|---|---|---|---:|---|
| **T1 frontier** | flagship | high | read-only by default; explicitly authorized write | 180 | thinking / decisions / review / fallback redo |
| **T2 standard** | standard | medium | read-only by default; explicitly authorized write | 120 | regular implementation |
| **T3 fast** | fast / local | low | read-only by default; explicitly authorized write | 60 | mechanical small tasks |

Standard anchored to **vendor product-line tiers** (every vendor already ships flagship/standard/fast). Every write capability requires explicit `addTools` authorization and a project-relative `writeScope`. A worker may request one extra 60–120 work-tool calls (a multiple of 10) through `dteam_signal`; the main agent explicitly grants or denies it. If that allocation is exhausted again, the main agent must dispatch a fresh worker rather than extending it again. `dteam_signal` and the required final `dteam_report` are not counted.

## Tier model configuration

dteam requires a personal configuration file; it never infers tiers from a model name or price and never silently falls back to the current `ctx.model`:

`~/.pi/agent/pi-dteam.json`：

```json
{
  "tiers": {
    "T1": ["openai-codex/gpt-5.6-terra:high", "openai-codex/gpt-5.6-sol:high"],
    "T2": ["openai-codex/gpt-5.6-luna:medium"],
    "T3": ["openai-codex/gpt-5.3-codex-spark:low"]
  }
}
```

Each tier is an ordered candidate array: `provider/model[:thinking]`; later entries are tried as fallbacks. `thinking` is optional and defaults to T1 `high`, T2 `medium`, or T3 `low`. Supported suffixes are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. If the file is missing or incomplete, dteam warns at session startup and refuses dispatch until fixed. After editing the file, run `/reload` to load it in the current Pi session. `tools` remains the highest permission ceiling across every fallback attempt.

## When to use dteam vs dgoal

One-line rule: **decide planning assurance and worker execution separately: use the appropriate dgoal Plan when visible progress or independent audit adds value, and use dteam when fresh, model-tiered workers add value; combine them when both apply.**

| Judgment | Use |
|---|---|
| Existing context is sufficient and the task is tiny | Main LLM directly |
| Clear ordinary multi-step execution needs visible progress, without independent audit | **Task Plan** |
| Non-trivial repository work still needs facts, bounded external-source extraction, mechanical implementation, or fresh verification | **dteam** (bounded, read-only T3-first evidence rounds by default; parallelism is optional) |
| The goal needs a frozen acceptance contract and one final independent audit | Explicit `/dgoal` with a **Phase Plan** |
| Each delivery stage and the final goal both need independent audit | Explicit `/dgoal` with a **Goal Plan** |
| Planning assurance and isolated tiered execution both add value | Use the selected Plan to own progress and checks; use **dteam** inside the current slice as needed |
| User explicitly chooses an entry | Respect the user |

The main agent retains goal understanding, source selection, evidence synthesis, conflict resolution, tier escalation, and closure. dteam does not own or update a Plan, resolve user-only decisions, replace `/dgoal` confirmation, run `phase_check` / `goal_check`, or perform the final `plan_update` closure.

Full protocol: see [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md).

## Current state

- ✅ **0.7.0**: T1/T2/T3 fresh dispatch, same-tier provider fallback, timeout, cancellation, adaptive concurrency, and explicit tier model chains.
- ✅ **0.8.0 runtime**: session-scoped Worker Manager, multi-worker acceptance, typed signals, deferred response, restricted dynamic tools, `/dteam` management and confirmed cancellation are implemented.
- ✅ **ADR 0020/0021 evolution**: multi-round evidence routing is documented as the normative main-agent default; WorkerReport, prompts, Manager aggregation, handoff provenance, and TUI projections use the new outcome/activity/verification contract.
- ✅ 0.6 Orchestrator Loop / Signal Store / five-role source and UI have been removed; ADR 0005–0007 remain as historical decisions only.
- ✅ `npm test` (Bun) covers the 0.7 routing base and 0.8 manager, signals, dynamic tools, cancellation, UI state, and entry.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Run tests
npm test

# 3. Check diff formatting
git diff --check

# 4. Install into Pi
pi install "$(pwd)"

# 5. /reload in Pi

# 6. Smoke-test the 0.8 runtime
# Ask the main LLM to call dteam_dispatch({ workers: [{ title: "...", task: "...", tier: "T3" }] }).
```

## Documentation

- [Documentation overview](./doc/README.md)
- [ADR 0008 — model-tier routing execution layer](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md)
- [ADR 0020 — evidence-driven multi-round main-agent routing](./doc/决策档案/0020-主代理证据驱动多轮路由协议.md)
- [ADR 0021 — unified WorkerReport and verification model](./doc/决策档案/0021-结构化工作报告区分动作完成度与验证深度.md)
- [Glossary](./doc/术语表.md)
- [System architecture (tier routing + dispatch)](./doc/10-架构与运行/10-系统架构.md)
- [Tier system (T1/T2/T3)](./doc/10-架构与运行/11-角色系统.md)
- [Tool API reference (dteam)](./doc/10-架构与运行/12-API参考.md)
- [dteam trigger protocol (dteam vs dgoal)](./doc/10-架构与运行/14-dteam触发协议.md)
- [0.8 session-scoped background runtime + signal protocol (design)](./doc/10-架构与运行/15-dteam会话级后台运行时与信号协议.md)
- [Project roadmap (0.8 runtime)](./doc/30-路线图/30-项目路线图.md)
- [Wayfinder, Ponytail, and evidence-driven routing reference](./doc/20-能力参考/30-Wayfinder-Ponytail与证据驱动路由参考.md)
- [zcode-swarm reference (blockedBy isomorphic, coordinator印证)](./doc/20-能力参考/29-zcode-swarm蜂群插件参考.md)
- [src/ internal architecture](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [中文 README](./README-zh.md)

## Design philosophy (0008)

- **Evidence-driven tier routing, not an orchestration engine**: the main agent owns evidence questions, source selection, rounds, and closure; Worker Manager never becomes a workflow director. Small models gather facts and do bounded mechanical work.
- **Four explicit tools**: dispatch, ordinary responses, timeout recovery, and explicit dependency wait have separate schemas; there is no Orchestrator Loop.
- **Fresh isolation**: dispatch workers are in-process `AgentSession` + Logical Isolation, naturally fresh — so review counters the main model's bias.
- **Thinking follows tier**: small models with high thinking have diminishing returns; hard tasks fall back to the strong model rather than over-thinking on a small model.
- **Orthogonal to dgoal**: dteam provides model-tier routing and fresh-context execution; dgoal provides Task / Phase / Goal Plans with increasing planning and independent-audit assurance. They can be composed, but dteam never takes ownership of Plan state or checks.

## Superseded history (traceability)

- **ADR 0006/0007 adversarial deliberation** (2026-07): prototyped, found "tedious and useless" (score system cost vs benefit), superseded by 0008. The fresh-check component was resurrected into 0008's review usage.
- **ADR 0005 self-growing summon pool** (0.6.0): Orchestrator Loop + SignalStore; positioning superseded by 0008 and its runtime was deleted in 0.7.0.
- **0.5.0 two-dimensional orchestration** (`solo/chain/team` × `direct/build_check/adaptive`): removed in 0.6.0.

## Related links

- Pi extension development: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- Sister project pi-dgoal: <https://github.com/ssdiwu/pi-dgoal>
