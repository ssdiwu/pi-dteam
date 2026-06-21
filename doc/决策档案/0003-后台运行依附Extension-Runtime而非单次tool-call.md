# 后台运行依附 Extension Runtime，而非单次 tool call

> **⛔ 状态：已被 [ADR 0005](./0005-dteam-0.6.0-重定义为自发生长召唤池.md) 推翻。**
> 0.6.0 重定义后，dteam 放弃后台运行，改为同步前台 Orchestrator Loop（编排循环）。本 ADR 保留仅作历史追溯，**不再有效**。
> `runId`、`RunsStore`、后台 `SignalBus`、立即返回式 run 等概念均已失效。

dteam 的后台协作状态依附在 Pi extension（扩展）承载的运行环境上，而不是依附于单次 tool call（工具调用）。启动通道和运行态展示通道分离。

**背景**：早期实现依赖工具调用的 `onUpdate`（流式更新回调）来推送进度。但工具调用一旦返回，`onUpdate` 就结束，无法持续展示后台运行状态。

**决定**：`dteam(action="run")` 立即返回 `{ status: "running", runId }`，后台继续执行；实时进度通过 `/dteam` 面板、widget（小组件）、状态栏观察；结束后通过 `dteam-report`（结果报告）消息进入主对话。

**为什么**：这是 v0.4.1 的核心收口。后台任务的生命周期天然长于单次工具调用，必须有一个不随调用返回而消亡的状态载体。

**权衡**：需要维护 `RunsStore` 和 `SignalBus`；换来后台任务可观察、不阻塞主对话、不依赖工具调用生命周期。

**关联**：`doc/10-架构与运行/10-系统架构.md` 第 1 节；术语表 Extension Runtime / Background Collaboration State Machine。
