# 26-Gemma concurrent 本地多 agent 并行参考

> **0.8 状态注记（2026-07-14）**：本文中出现的 Orchestrator Loop、Signal Store、五角色、Reporter，均是调研时用于对照的 0.6 历史形态，已删除。当前 dteam 已实现会话级后台 Worker Manager、唯一工具 `dteam`（dispatch/respond）、有类型 signal 和 `/dteam` 实时管理面板；以下内容只作机制比较，不描述当前实现。

> 调研对象：[`google-gemma/cookbook/apps/concurrent`](https://github.com/google-gema/cookbook/tree/main/apps/concurrent)（Google Gemma 官方 2026-06-17 发布）
> 来源：[微信文章](https://mp.weixin.qq.com/s/6-QZZ4nv0gfM1jLccHewTg) + GitHub README
> 调研日期：2026-06-22

## 1. 总体判断

**部分值得，价值在印证而非架构。**

cookbook 的编排形态（"orchestrator 一次性拆成 JSON 任务列表 → fan-out 给 N 个同质 worker"）与旧 dteam 0.6 编排草案的“无预先 Task Plan”讨论不同；该历史形态不代表当前 0.8。当前 dteam 以 ADR 0008/0012 的主代理路由、T1/T2/T3、同档候选和相邻升级为准，整体同质编排形态明确不借。它真正有价值的是用可复现代码证明了一件事：**本地 MoE 推理 + 共享权重 slot（`-np N`）让多 agent 并发的边际成本趋近零**——这给 dteam 的 Multi-Provider Routing 提供了一个「本地 provider 降级候选」的远期备查项，不进路线图优先级。

## 2. 核心机制速览

1. **单进程共享权重 + 并发 slot**：一个 `llama-server` 进程把模型只加载一次，`-np 10` 开 10 个并发 slot 共享同一份权重并行推理。context 按 `-c / -np` 切分到每个 slot。这是它"100+ tokens/s 系统总吞吐"的物理基础。
2. **MoE 低激活让并行便宜**：Gemma 4 26B A4B 每次 token 只激活约 4B 参数，10 路并发时 GPU/统一内存带宽被榨干但不会 OOM；换稠密模型早爆了。这是"本地能并发"的前提，不是编排层面的设计。
3. **orchestrator 先规划再 fan-out**：orchestrator 先用一个 Gemma 实例把目标拆成结构化 JSON 任务列表（`plan` 的 `system`/`user` prompt 输出 JSON 数组），再分发给 N 个 worker slot。worker 各领一块、独立生成、互不通信。
4. **worker 无状态一次性并行**：N 个 worker 是同质的、无状态的 fan-out，没有信号回流、没有根据中间结果调整后续召唤。最终结果靠 `template` 函数拼装。
5. **scenario 注册式扩展**：`scenarios.py` 用 `SCENARIOS["name"] = { make_agents, plan, template, system_prompt, default_n }` 注册新场景，换 prompt 即换用途（svg/translate/code/ascii），框架不动。
6. **本地零云端**：全程本地，无 API key / rate limit / 数据出门，边际成本趋近零。硬件门槛：32GB+ 统一内存的 Mac 或同等配置，16GB 会激烈 swap。

## 3. 与 dteam 的关系

### 3.1 设计冲突（明确不借）

- **「先规划 JSON 任务列表再 fan-out」与当前主代理路由边界不同**：cookbook 的 orchestrator 一次性把目标拆成固定 JSON 列表再分发给固定 N 个 worker，本质是「预先 plan + fan-out 执行」。当前 dteam 由主代理直接选择独立 dispatch，不恢复旧 0.6 的 LLM 编排循环或任务计划图；同质预先分发形态**不借**。
- **「N 个同质 worker 无状态并行」与旧 0.6 dteam 的信号驱动异构召唤不同**：cookbook 的 worker 是一次性 fan-out，不回流信号、不根据中间结果调整。旧 0.6 dteam 曾通过 `worker_sendSignal`、Signal Store 和 Orchestrator 组织固定角色；该形态已删除。当前 0.8 dteam 由主代理路由，Worker Manager 投影有界 Snapshot，timeout recovery 由主代理经 `respond` 决定。照搬同质并发池仍会忽略当前的权限、预算和验收边界，**不借**。
- **「固定 N 同质 worker 池」与旧 0.6「固定五角色异构」定位不同**：cookbook 开 10 个同质 worker 干同类活；当前 0.8 dteam 使用 T1/T2/T3 档位和按需工具授权，不再维护五角色。这里仍不借同质并发池形态。

### 3.2 同思路（已有，印证方向）

- **LLM 做结构化任务拆解/分发**：cookbook orchestrator 输出 JSON plan；当前 dteam 的 `dteam` 工具使用结构化 `dispatch/respond` schema，由主代理决定 worker、tier 与 recovery action。可复用的是结构化 tool calling，不是旧 `orchestrator_decide` 循环。
- **并发 worker + 实时可视化**：cookbook 终端网格 + dashboard 实时显示 token 速率；当前 0.8 dteam 的 `/dteam` panel 展示 Worker Snapshot 的实时文本、thinking、工具活动和 timeout 诊断。方向有借鉴，但不引入 Live Loop View、widget 或 Orchestrator。
- **scenario 注册式扩展**：cookbook `scenarios.py` 模板化扩展；dteam 当前以 `tier-config.ts` 固定 T1/T2/T3，不做角色市场或场景注册。三档已足够，无需吸收。

### 3.3 候选（值得吸收）

- **本地推理 provider 作为可选降级路径**（远期/可选，不进路线图优先级）：
  - 机制：cookbook 证明本地 `llama-server -np N` 共享权重 slot 能支撑并发且边际成本零（无 API key / rate limit / 数据出门）。
  - 改造点：`src/dispatch/model-routing.ts` 的 `FallbackModels` 链可声明本地 endpoint（如 `provider: "llama-server-local"`），当云端 429 / 成本敏感 / 隐私 / 无网络场景时 fallback 到本地。
  - 边界：这是「加一个 provider 候选」，不破坏编排架构。本地推理能力本身（GGUF 加载、slot 调度）是 Pi model registry 层职责，dteam 只在 routing 层声明可用、选模型时优先级降级。dteam 的主线价值是群策群力编排，不是本地推理省钱，所以这是降级项不是主线。
  - 触发条件：只有当 507 出现明确的「离线 / 隐私 / 成本敏感」真实场景时才推进；当前个人编程场景云端 API 是主流，不急。

- **并发上限受 provider slot 数硬约束**（低价值备查项，随上一条配套）：
  - 机制：cookbook `-np` 显式声明 slot 上限，并发度被物理硬约束。
  - 改造点：`src/dispatch/concurrency.ts` 的 `ConcurrencyConfig` 可选增加 `backendSlotLimit` 字段，Adaptive Concurrency 的 `max` 不超过 backend 实际 slot 数。
  - 价值低：云端 provider 本来就是 429 反应式探测、无固定 slot 概念（见 `concurrency.ts` 现有 429 自适应逻辑）；只有启用上一条「本地 provider」时此约束才有意义。作为配套备查，不单独推进。

## 4. 可借鉴的具体文件 / 代码 / 资源

- `apps/concurrent/README.md` — 快速开始、`-np` slot 语义、scenario 扩展点
- `apps/concurrent/demo/scenarios.py` — scenario 注册模式（`make_agents` / `plan` / `template` / `system_prompt` / `default_n`），对照 dteam 角色配置看异构 vs 同质差异
- `run.sh` — 启动参数和 AppleScript 可视化（炫技层，dteam 不需要）

## 5. 决策记录

无。两条候选均为远期/可选备查项，未达「难逆转 + 无上下文会困惑 + 有真实权衡」门槛，不进 `doc/决策档案/`。若 507 后续真要做「本地 agent 离线模式」，再回来据此起 ADR。

## 6. 下一步建议

备查即可。候选价值中等且属远期，**不推荐走 `507-grill`**（没有需要拷问的难逆转决策）。若 507 后续提出「离线/隐私/成本敏感」场景需求，再回来读本参考，届时可用 `507-grill` 拷问「本地 provider 是否进 fallback 链」这一具体决策。