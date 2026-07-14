# dteam

> **Pi 的模型分级路由执行层 —— 小任务甩给小模型批量做，强模型负责思考。**

主模型（T1 思考档）作为 owner：负责思考/决策/综合/路由/验收，把小任务 fan-out 给小模型（T3 快速档）并行批量做。思考强度跟随档位；小模型搞不定时走 fresh 验收 → 回退强模型。

**姊妹项目**：[`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) —— 独立并列。**dteam = 多模型分级路由，dgoal = 单模型建检循环**。主 LLM 自己判断用哪个，不合并、不自动切换。英文版：[`README.md`](./README.md)。

> **0.8.0 实现状态**：在 [ADR 0008](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md) 的档位路由基础上，已落地 ADR 0009–0011：会话级后台 worker、有类型 signal、受限动态工具、`/dteam` 管理入口和唯一模型工具 `dteam`。

## TL;DR

dteam 的存在理由是**强模型做小任务是双重浪费**（贵 + 慢）。它的价值是分级路由——这是 dgoal（单模型全程）结构上做不到的。

- **单工具 `dteam({ type: "dispatch" | "respond", ... })`** —— 派发和回应共用一个模型工具；`/dteam` 是用户管理命令。
- **T1/T2/T3 模型档位**（取代旧五角色）—— 标准锚定供应商产品线（旗舰/标准/快速）。
- **思考跟随档位** —— T1高/T2中/T3低；难任务走回退换强模型（自带高思考），不是让小模型多想。
- **fresh 验收（可选）** —— dispatch 创建隔离的进程内 `AgentSession` worker；仅关键任务由主模型显式调 T1 只读验收，对抗主模型"给自己判卷"的倾向。
- **回退** —— 硬失败自动回退；质量不过走 fresh 验收触发回退。
- **Adaptive Concurrency + Multi-Provider Routing** —— 多 worker 并发，每档可配主模型 + fallback 链。

## 模型档位（T1/T2/T3）

| 档位 | 模型 | 思考 | 默认工具 | 用途 |
|---|---|---|---|---|
| **T1 思考档** | 旗舰 | 高 | 全工具（读写改 + 审核） | 思考 / 决策 / 验收 / 回退重做 |
| **T2 标准档** | 标准 | 中 | 可写（读写改） | 常规实现 |
| **T3 快速档** | 快速 / 本地 | 低 | 默认只读；显式限定写 | 机械小任务 |

标准锚定**供应商产品线层级**（每家供应商都已分好旗舰/标准/快速三线）。dispatch 可覆盖默认配置（如 T3 临时给可写权限做独立模块小改）。

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

一句话规则：**简单任务主 LLM 直接干；单兵能持续推进 + 需独立审核走 dgoal；有一批小任务可分级并行加速（甩给小模型批量做）走 dteam；用户明确指定时尊重用户。**

| 判断 | 走哪个 |
|---|---|
| 单代理能干，自己推进 | 主 LLM 直接做 |
| 单兵推进 + 需要独立零上下文终审 | **dgoal**（单模型建检） |
| 有一批独立小任务可并行 / 甩给小模型 | **dteam**（分级路由） |
| 用户明确说"用 dteam" | **dteam** |

完整协议见 [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md)。

## 当前状态

- ✅ **0.7.0**：T1/T2/T3 fresh dispatch、provider/T1 回退、超时、取消、自适应并发和显式档位模型链均已实现。
- ✅ **0.8.0 runtime**：会话级 Worker Manager、多 worker 受理、有类型 signal、阻塞回应、受限动态工具、`/dteam` 管理和确认取消均已实现。
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
# 让主 LLM 调用 dteam({ type: "dispatch", workers: [{ title: "...", task: "...", tier: "T3" }] })。
```

## 文档

- [文档导航](./doc/README.md)
- [ADR 0008 —— 重定位为模型分级路由（当前权威）](./doc/决策档案/0008-dteam重定位为模型分级路由执行层.md)
- [术语表](./doc/术语表.md)
- [系统架构（分级路由 + dispatch）](./doc/10-架构与运行/10-系统架构.md)
- [档位系统（T1/T2/T3）](./doc/10-架构与运行/11-角色系统.md)
- [工具 API 参考（dteam）](./doc/10-架构与运行/12-API参考.md)
- [dteam 触发协议（dteam vs dgoal）](./doc/10-架构与运行/14-dteam触发协议.md)
- [0.8 会话级后台运行时与信号协议（设计）](./doc/10-架构与运行/15-dteam会话级后台运行时与信号协议.md)
- [项目路线图（0.8 runtime）](./doc/30-路线图/30-项目路线图.md)
- [zcode-swarm 蜂群插件参考（blockedBy 同构、coordinator 印证）](./doc/20-能力参考/29-zcode-swarm蜂群插件参考.md)
- [src/ 内部架构](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [English README](./README.md)

## 设计哲学（0008）

- **分级路由，不是编排引擎**：dteam 不是召唤池、不是对抗式合议、不是工作流平台——它是模型分级路由。强模型思考，小模型批量做机械活。
- **单工具 dteam**：dispatch/respond 共用一个工具；没有点号后缀工具，没有 Orchestrator Loop。
- **fresh 隔离**：dispatch worker 是进程内 `AgentSession` + Logical Isolation，天然 fresh——所以验收能对抗主模型倾向。
- **思考跟随档位**：小模型高思考收益递减；难任务走回退换强模型，而非让小模型多想。
- **与 dgoal 并列**：分级路由（dteam）vs 单模型建检（dgoal），独立不合并。

## 已推翻的历史（保留追溯）

- **ADR 0006/0007 对抗式合议**（2026-07）：原型验证"繁琐且无用"（积分制成本收益不成正比），被 0008 推翻。fresh check 零件被 0008 复活到验收用法。
- **ADR 0005 自发生长召唤池**（0.6.0）：Orchestrator Loop + SignalStore；定位被 0008 推翻，相关运行时已在 0.7 删除。
- **0.5.0 二维编排**（`solo/chain/team` × `direct/build_check/adaptive`）：0.6.0 已删。

## 相关链接

- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- 姊妹项目 pi-dgoal：<https://github.com/ssdiwu/pi-dgoal>
