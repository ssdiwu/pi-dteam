# dteam API 参考

> 0.8 当前模型侧只注册一个工具：`dteam`。`/dteam` 是用户管理命令，不是第二个模型工具。
>
> **实施状态**：会话级后台 Worker Manager、星型 signal、受限动态工具和 `/dteam` 管理入口已实现；真实 provider 冒烟仍需在目标环境复核。

## 0. 必需的个人模型配置

配置文件：`~/.pi/agent/pi-dteam.json`。

```json
{
  "tiers": {
    "T1": { "model": "openai-codex/gpt-5.6-terra" },
    "T2": { "model": "openai-codex/gpt-5.6-luna" },
    "T3": { "model": "openai-codex/gpt-5.3-codex-spark" }
  }
}
```

三档 `model` 都必填；可选 `fallbackModels`。文件缺失、JSON 无效、档位缺失或模型不是 `provider/id` 格式时，session 启动会显著提醒，`dteam` 进入 fail-closed，不会使用主会话 `ctx.model`。

## 1. 模型工具：`dteam`

`dteam` 用 `type` 区分两种动作：

### 1.1 派发

```ts
dteam({
  type: "dispatch",
  workers: [{
    title: "读取配置",
    task: "独立完成这个自包含任务，并报告证据",
    tier: "T3",
    addTools: [],
  }],
})
```

- `workers` 必须是 1–32 项；每项独立返回 `workerId`。
- `title`、`task`、`tier` 必填，`tier` 为 `T1` / `T2` / `T3`。
- `addTools` 是本次 worker 的预授权候选上限，不接受能力标签。
- dteam 立即返回 queued 接收凭据；完成结果经主会话 follow-up 回传。
- 多项只是一次调用参数列表，不产生 `batchId`，不表达依赖。

### 1.2 回应阻塞请求

```ts
dteam({
  type: "respond",
  workerId: "...",
  requestId: "...",
  response: { type: "provide_context", context: "最小必要上下文" },
})
```

`response.type` 支持：

- `provide_context`：提供上下文。
- `grant_tools`：只授予本次 `addTools` 候选。
- `decision`：提供主代理决定。
- `deny`：明确拒绝及原因。

回应先更新权限或请求状态，再兑现原 worker 的 `dteam_signal` 阻塞工具调用；不创建新 session，不依赖 `followUp()` 解锁。

## 2. Worker 与 signal

worker 是当前 Pi 进程内的 fresh `AgentSession`。Worker Manager 管理：

- `queued → running → waiting → completed/failed/timed_out/cancelled/shutdown` 生命周期；超时、用户取消和 session shutdown 保持独立终态；
- T3/T2 到 T1 回退、共享 Adaptive Concurrency；
- `progress` / `finding` 过程事实；
- `request_context` / `request_tools` / `request_decision` / `blocked` 阻塞请求。

worker 只能经 `dteam_signal` 向 Manager 发信号，不能 P2P；主代理经 `dteam` 回应。成功结果 500ms 短窗合并，失败、取消和阻塞请求立即回传。

## 3. 工具权限

worker 创建时注册 `baseTools ∪ addTools ∪ dteam_signal`，首次 prompt 前只激活基础工具与 signal。`request_tools` 只能激活已注册且属于本次 `addTools` 的精确名称；未知工具由 dteam fail-closed 拒绝。

当前第三方 extension 候选无法通过公开 API 安全地最小加载，因此 0.8 只开放 built-in 与 dteam custom 工具候选，不全量加载 extension。

## 4. `/dteam` 管理命令

`/dteam` 提供按需 overlay 列表和详情：运行中 worker 可 steering；取消必须二次确认并记录 `user_cancelled`；结束 worker 只读封存。没有活跃 worker 时仍可查看当前进程内历史记录。

Pi session shutdown / reload 会中止活跃 worker，不做 resume 或跨进程恢复。

## 5. 不提供

- `dteam_dispatch`：仅为 0.7 历史工具名。
- `dteam.dispatch` / `dteam.respond`：仅为文档动作简称，不是注册工具名。
- batch、依赖图、Task Plan、goal/task 映射、自动续派。
- workflow 脚本、Orchestrator Loop、TTL Signal Store、五角色、P2P、resume、常驻浮窗。
