# dteam

> **Pi 的模型分级路由执行层 + 主代理证据驱动协议 —— 小模型取证和做机械活，强模型负责判断。**

主代理作为 owner：定义当前证据问题，分轮派互补的 T3 探测，综合报告后决定收口、补充取证、实施、验证或按 T3→T2→T1 明确升级。Worker Manager 只执行已经派发的 worker，不拥有轮次、依赖或下一项任务。

**姊妹项目**：[`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) —— 独立并列。**dteam = 模型分级路由与 fresh 上下文执行，dgoal = 三档 Plan 的计划保障与建检循环**。两套机制正交且可组合，不合并、不自动切换。英文版：[`README.md`](./README.md)。

> **当前实现状态**：ADR 0013–0021 已落地四工具、有界交接、递增成本执行、可写中断守卫、人类可读投影、主代理证据驱动多轮协议，以及区分任务完成度、实际动作、事实与验证深度的统一 WorkerReport；`/dteam` 仍是用户管理入口。

## TL;DR

dteam 的存在理由是**强模型做小任务是双重浪费**（贵 + 慢）。它的价值是模型分级路由与 fresh 上下文隔离——这些执行层能力不由 dgoal 的 Plan 与独立审核模型提供。

- **证据驱动多轮路由** —— 非极小代码任务先派有界、互补的 T3 探测；主代理汇总后只为具体缺口追加下一轮。
- **四工具** —— `dteam_dispatch`、`dteam_respond`、`dteam_recover` 与显式依赖等待 `dteam_wait` 职责分离；`/dteam` 是用户管理命令。
- **统一 WorkerReport** —— `outcome`、实际 `activities`、带来源 `facts` 与实际 `verification` 分开；Manager `completed` 不代表任务或验证通过。
- **T1/T2/T3 模型档位**（取代旧五角色）—— 标准锚定供应商产品线（旗舰/标准/快速）。
- **思考跟随档位** —— T1高/T2中/T3低；主模型汇总低档事实后再逐级升级，不是让小模型多想。
- **fresh 验收（可选）** —— dispatch 创建隔离的进程内 `AgentSession` worker；仅关键任务由主模型显式调 T1 只读验收，对抗主模型"给自己判卷"的倾向。
- **回退与升级** —— 同档模型候选为可用性自动回退；跨档由主模型按 T3→T2→T1 明确决定。
- **Adaptive Concurrency + Multi-Provider Routing** —— 多 worker 并发，每档可配主模型 + fallback 链。

## 模型档位（T1/T2/T3）

| 档位 | 模型 | 思考 | 默认工具 | 初始工作工具额度 | 用途 |
|---|---|---|---|---:|---|
| **T1 思考档** | 旗舰 | 高 | 默认只读；显式最小授权写 | 180 | 思考 / 决策 / 验收 / 回退重做 |
| **T2 标准档** | 标准 | 中 | 默认只读；显式最小授权写 | 120 | 常规实现 |
| **T3 快速档** | 快速 / 本地 | 低 | 默认只读；显式最小授权写 | 60 | 机械小任务 |

标准锚定**供应商产品线层级**（每家供应商都已分好旗舰/标准/快速三线）。任何写入都必须通过 `addTools` 显式最小授权，并声明项目相对 `writeScope`。worker 可通过 `dteam_signal` 申请一次额外的 60–120 次工作工具调用（10 的倍数），由主代理明确批准或拒绝；追加后仍耗尽时，主代理必须重新 dispatch fresh（全新）worker，不能再次追加。`dteam_signal` 与必需的最终 `dteam_report` 均不计入额度。

## 档位模型配置

dteam 必须有个人配置文件，不按模型名称或价格猜档，也不会静默回落当前 `ctx.model`：

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

每档是按顺序尝试的候选数组，格式为 `provider/model[:thinking]`；后续项就是回退模型。`thinking` 可省略，默认 T1 为 `high`、T2 为 `medium`、T3 为 `low`；支持 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`。配置文件不存在或不完整时，dteam 会在 session 启动时显著提醒，并拒绝派发，修复配置后需执行 `/reload` 才会在当前 Pi session 生效。`tools` 始终是所有回退尝试的最高权限上限。

## 什么时候用 dteam vs dgoal

一句话规则：**分别判断计划保障与 worker 执行：需要可见进度或独立审核时选择合适的 dgoal Plan，需要 fresh、模型分级的 worker 时使用 dteam；两者同时有价值就组合使用。**

| 判断 | 走哪个 |
|---|---|
| 现有上下文足够且任务极小 | 主代理直接处理 |
| 明确的普通多步执行需要可见进度，但不需要独立审核 | **Task Plan** |
| 非极小仓库任务仍需事实、受限外部材料提取、机械实施或 fresh 复验 | **dteam**（默认先做有界、只读的 T3-first 分轮取证；是否并行不是前提） |
| 目标需要冻结验收契约和一次最终独立审核 | 显式 `/dgoal`，采用 **Phase Plan** |
| 每个交付阶段和最终 goal 都需要独立审核 | 显式 `/dgoal`，采用 **Goal Plan** |
| 计划保障和隔离的分级执行同时有价值 | 由所选 Plan 管进度与审核；按需在当前切片内使用 **dteam** |
| 用户明确指定入口 | 服从用户 |

主代理保留目标理解、来源选择、证据综合、冲突裁决、档位升级与收口责任。dteam 不拥有或更新 Plan，不处理只能由用户决定的问题，不替代 `/dgoal` 确认、`phase_check` / `goal_check`，也不执行最终的 `plan_update` 收口。

完整协议见 [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md)。

## 当前状态

- ✅ **0.7.0**：T1/T2/T3 fresh dispatch、同档 provider 回退、超时、取消、自适应并发和显式档位模型链均已实现。
- ✅ **0.8.0 runtime**：会话级 Worker Manager、多 worker 受理、有类型 signal、阻塞回应、受限动态工具、`/dteam` 管理和确认取消均已实现。
- ✅ **ADR 0020/0021 演进**：主代理多轮证据路由已成为规范性默认；WorkerReport、prompt、Manager 聚合、handoff 来源与 TUI 投影已使用新的 outcome / activity / verification 合同。
- ✅ 0.6 Orchestrator Loop / Signal Store / 五角色源码及 UI 已删除；ADR 0005–0007 只保留为历史决策。
- ✅ `npm run build` 与 `npm test` 覆盖 0.7 dispatch 契约、factory、执行、路由、并发和入口。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 跑测试
npm test

# 4. 安装到 Pi
pi install "$(pwd)"

# 5. 在 Pi 里 /reload

# 6. 冒烟验证 0.8.0
# 让主 LLM 调用 dteam_dispatch({ workers: [{ title: "...", task: "...", tier: "T3" }] })。
```

## 文档

- [文档导航](./doc/README.md)
- [ADR 0008 —— 模型分级路由执行层](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md)
- [ADR 0020 —— 主代理证据驱动多轮路由](./doc/决策档案/0020-主代理证据驱动多轮路由协议.md)
- [ADR 0021 —— 统一 WorkerReport 与验证模型](./doc/决策档案/0021-结构化工作报告区分动作完成度与验证深度.md)
- [术语表](./doc/术语表.md)
- [系统架构（分级路由 + dispatch）](./doc/10-架构与运行/10-系统架构.md)
- [档位系统（T1/T2/T3）](./doc/10-架构与运行/11-角色系统.md)
- [工具 API 参考（dteam）](./doc/10-架构与运行/12-API参考.md)
- [dteam 触发协议（dteam vs dgoal）](./doc/10-架构与运行/14-dteam触发协议.md)
- [0.8 会话级后台运行时与信号协议（设计）](./doc/10-架构与运行/15-dteam会话级后台运行时与信号协议.md)
- [项目路线图（0.8 runtime）](./doc/30-路线图/30-项目路线图.md)
- [Wayfinder、Ponytail 与证据驱动路由参考](./doc/20-能力参考/30-Wayfinder-Ponytail与证据驱动路由参考.md)
- [zcode-swarm 蜂群插件参考（blockedBy 同构、coordinator 印证）](./doc/20-能力参考/29-zcode-swarm蜂群插件参考.md)
- [src/ 内部架构](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [English README](./README.md)

## 设计哲学（0008）

- **证据驱动分级路由，不是编排引擎**：主代理拥有证据问题、来源选择、轮次和收口；Worker Manager 永不变成工作流导演。小模型取证和完成有界机械活。
- **四工具**：派发、普通回应、超时恢复和显式依赖等待有独立 schema；没有 Orchestrator Loop。
- **fresh 隔离**：dispatch worker 是进程内 `AgentSession` + Logical Isolation，天然 fresh——所以验收能对抗主模型倾向。
- **思考跟随档位**：小模型高思考收益递减；难任务走回退换强模型，而非让小模型多想。
- **与 dgoal 正交**：dteam 提供模型分级路由与 fresh 上下文执行；dgoal 提供保障强度递增的 Task / Phase / Goal Plan。二者可以组合，但 dteam 不接管 Plan 状态或独立审核。

## 已推翻的历史（保留追溯）

- **ADR 0006/0007 对抗式合议**（2026-07）：原型验证"繁琐且无用"（积分制成本收益不成正比），被 0008 推翻。fresh check 零件被 0008 复活到验收用法。
- **ADR 0005 自发生长召唤池**（0.6.0）：Orchestrator Loop + SignalStore；定位被 0008 推翻，相关运行时已在 0.7 删除。
- **0.5.0 二维编排**（`solo/chain/team` × `direct/build_check/adaptive`）：0.6.0 已删。

## 相关链接

- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- 姊妹项目 pi-dgoal：<https://github.com/ssdiwu/pi-dgoal>
