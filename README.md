# dteam

> **A model-tier routing execution layer for Pi — small tasks fan out to small models, the strong model thinks.**

The main model (T1 frontier tier) acts as owner: it thinks / decides / routes / reviews, and fans out small tasks to small models (T3 fast tier) in parallel. Thinking budget follows the tier; when a small model can't deliver, a fresh review falls back to the strong model.

**Sister project**: [`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) — independent and parallel. **dteam = multi-model tier routing; dgoal = single-model build-check loop.** The main LLM chooses which to use; they are not merged, not auto-switched. Chinese version: [`README-zh.md`](./README-zh.md).

> ⚠️ **Positioning vs code gap**: The positioning authority is [ADR 0008 (model-tier routing)](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md). The `src/` codebase is **still the 0.6.0 Orchestrator Loop + SignalStore shape**; the 0008 refactor (cut the loop/signals, build `dteam_dispatch`, replace five roles with T1/T2/T3) is **pending**. Don't assume the code is already in the new shape.

## TL;DR

dteam exists because **using a strong model for small tasks is a double waste** (expensive + slow). Its value is tier routing — something dgoal (single-model throughout) structurally cannot do.

- **Single tool `dteam_dispatch(task, tier, thinking?, tools?)`** — execution / fresh review / fallback are all different uses of the same tool.
- **T1 / T2 / T3 model tiers** (replace the old five roles) — anchored to vendor product lines (flagship / standard / fast).
- **Thinking follows tier** — T1 high / T2 medium / T3 low; hard tasks fall back to the strong model (which has high thinking built in), rather than making a small model think longer.
- **Fresh review** — dispatch creates isolated in-process `AgentSession` workers; review workers are naturally fresh (can't see the main session), countering the main model's "grade your own homework" bias.
- **Fallback** — hard failure auto-falls back; quality failure triggers fallback via fresh review.
- **Adaptive Concurrency + Multi-Provider Routing** — multiple workers in flight, per-tier model + fallback chains.

## Model tiers (T1/T2/T3)

| Tier | Model | Thinking | Default tools | Use |
|---|---|---|---|---|
| **T1 frontier** | flagship | high | full (rw + review) | thinking / decisions / review / fallback redo |
| **T2 standard** | standard | medium | writable (rw) | regular implementation |
| **T3 fast** | fast / local | low | on-demand (read or limited write) | mechanical small tasks |

Standard anchored to **vendor product-line tiers** (every vendor already ships flagship/standard/fast). dispatch can override defaults (e.g. temporarily grant write to T3 for an isolated module change).

## When to use dteam vs dgoal

One-line rule: **simple tasks are done directly by the main LLM; single-agent progression + independent audit uses dgoal; a batch of small tasks that can be tier-routed in parallel uses dteam; explicit user requests are respected.**

| Judgment | Use |
|---|---|
| Single agent can do it | Main LLM directly |
| Single-agent progression + needs independent zero-context audit | **dgoal** (single-model build-check) |
| A batch of independent small tasks to parallelize / offload to small models | **dteam** (tier routing) |
| User explicitly says "use dteam" | **dteam** |

Full protocol: see [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md).

## Current state

- ✅ 0.6.0 code landed (Orchestrator Loop + SignalStore + Logical Isolation + Adaptive Concurrency + Multi-Provider Routing) — **but this shape is superseded by ADR 0008**.
- ❌ 0.6.1/0.6.2 adversarial deliberation (ADR 0006/0007) prototyped and abandoned ("tedious and useless").
- ⏭ **0.7.0 (ADR 0008) refactor pending**: cut Orchestrator Loop / SignalStore / adversarial rounds, build `dteam_dispatch`, replace five roles with T1/T2/T3 tiers.
- ✅ `npm run build` passes; `npm test` green (covers 0.6.0 decision flow / concurrency / routing).

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

# 5. /reload in Pi

# 6. Smoke-test the current 0.6.0 runtime
# /dteam <goal>
# dteam_dispatch is the 0.7.0 target API and is not runnable yet.
```

## Documentation

- [Documentation overview](./doc/README.md)
- [ADR 0008 — reposition as model-tier routing (current authority)](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md)
- [Glossary](./doc/术语表.md)
- [System architecture (tier routing + dispatch)](./doc/10-架构与运行/10-系统架构.md)
- [Tier system (T1/T2/T3)](./doc/10-架构与运行/11-角色系统.md)
- [Tool API reference (dteam_dispatch)](./doc/10-架构与运行/12-API参考.md)
- [dteam trigger protocol (dteam vs dgoal)](./doc/10-架构与运行/14-dteam触发协议.md)
- [Project roadmap (0.7.0 refactor pending)](./doc/30-路线图/30-项目路线图.md)
- [zcode-swarm reference (blockedBy isomorphic, coordinator印证)](./doc/20-能力参考/29-zcode-swarm蜂群插件参考.md)
- [src/ internal architecture (0.6.0→0008 gap)](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [中文 README](./README-zh.md)

## Design philosophy (0008)

- **Tier routing, not orchestration engine**: dteam is not a summon pool, not adversarial deliberation, not a workflow platform — it's model-tier routing. The main model thinks; small models do mechanical work in batches.
- **Single tool `dteam_dispatch`**: execution / fresh review / fallback are all its uses; no separate check tool, no Orchestrator Loop.
- **Fresh isolation**: dispatch workers are in-process `AgentSession` + Logical Isolation, naturally fresh — so review counters the main model's bias.
- **Thinking follows tier**: small models with high thinking have diminishing returns; hard tasks fall back to the strong model rather than over-thinking on a small model.
- **Parallel to dgoal**: tier routing (dteam) vs single-model build-check (dgoal), independent, not merged.

## Superseded history (traceability)

- **ADR 0006/0007 adversarial deliberation** (2026-07): prototyped, found "tedious and useless" (score system cost vs benefit), superseded by 0008. The fresh-check component was resurrected into 0008's review usage.
- **ADR 0005 self-growing summon pool** (0.6.0): Orchestrator Loop + SignalStore; positioning superseded by 0008 (code remains as the 0.7.0 refactor starting point).
- **0.5.0 two-dimensional orchestration** (`solo/chain/team` × `direct/build_check/adaptive`): removed in 0.6.0.

## Related links

- Pi extension development: <https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- Sister project pi-dgoal: <https://github.com/ssdiwu/pi-dgoal>
