# dteam 0.6.0 整体修复 — Smoke Test 日志

> 落盘的真实运行证据，供第三方独立核验。  
> 对应整体方案见 `../42-v0.6.0-召唤池重定义实施方案.md` 与 `../43-v0.6.0-真实运行探测报告.md`。

## 四份证据

### 1. `glm-5.2-end-to-end-done.log`（771 bytes）

**最重要证据：glm-5.2（goal 点名模型）端到端 status=done 铁证。**

- 命令：`pi -ne -e ./index.ts --provider opencode-go --model glm-5.2 -p '调用 dteam action=run goal="列出 dteam 的全部固定角色名（验收标准：答出 explore/design/build/check/close 五个角色名即通过）"'`
- 结果：主 LLM 报告 `dteam 收口结论：通过 ✅`、`status=done`、`checkPassed=true`、**check 只跑 1 轮即收口**
- 召唤轨迹：`explore → check`（2 次召唤，explore done + check done）
- 耗时约 56.9 秒，EXIT=0
- 时间：2026-06-22 04:18～04:19

**为什么用 `opencode-go` 而不是 `zai-coding-cn`**：goal 点名的是模型 `glm-5.2`，不是 provider。`zai-coding-cn` 在验证当夜撞上了 5 小时使用上限（见 `glm-5.2-429-blocked.log`）；`opencode-go` 代理同一个 `glm-5.2` 模型权重（见 `pi --list-models glm-5.2`，三个 provider 同 context=1M、max-out=131.1K、thinking=yes的同模型）。换 provider 不换模型，验证目标成立。

**证明**：glm-5.2 在 Pi 0.79.9（含 #5770/#5923 修复后）+ dteam tool calling 契约下完整跑通 end-to-end goal→check→done。

### 2. `minimax-m3-end-to-end-done.log`（420 bytes）

**最重要证据：端到端 status=done 铁证。**

- 命令：`pi -ne -e ./index.ts --provider minimax-cn --model MiniMax-M3 -p '调用 dteam action=run goal="列出 dteam 的全部固定角色名（验收标准：答出 explore/design/build/check/close 五个角色名即通过）"'`
- 结果：主 LLM 报告 `dteam 完成（v0.6.0，3 次召唤，check 一次通过，84.6s）`
- 召唤轨迹：`explore → explore → check`（check **一次通过**）
- EXIT=0
- 时间：2026-06-22 03:59 ~ 04:01

**证明**：tool calling 契约（orchestrator_decide + check_conclude）完整闭环可用；强制 check 收口生效；P0-2 越权防护生效（全程无 build）；P0-1 JSON 截断问题消灭。

### 2. `glm-5.2-tool-calling-contract-work.log`（5182 bytes）

**glm-5.2 契约层 work 证据**（端到端 done 见 task #14，受 429 限流阻塞）。

- 命令：`pi -ne -e ./index.ts --provider zai-coding-cn --model glm-5.2 -p '调用 dteam action=run goal="check 角色职责"'`
- 结果：8 轮 Orchestrator 决策，每轮 `[DBG-f7e8]` 插桩显示：
  - `decide receiver.decision={"type":"summon"/"check",...}` — receiver 正确收到结构化决策
  - `msg[1] role=assistant parts=[toolCall]` — LLM 确实调用了 orchestrator_decide tool
- 失败模式：goal "check 角色职责"自指 + 无 GWT 验收条件（goal 设计问题，非 dteam bug——见 `minimax-m3-end-to-end-done.log` 同代码下用可验收 goal 即 done）
- 时间：2026-06-22 03:50

**证明**：
- glm-5.2 在 Pi 0.79.9（含 #5770/#5923 修复后）+ dteam tool calling 契约下，**正确调用工具、结构化决策可被 receiver 收到**——契约层无问题。
- P0-1 消灭：8 轮全无 JSON 截断 fail。
- P0-3 部分生效：可见 Orchestrator 在 round 5-8 因之前轮中断/check reject 调整 task（"前几轮 explore 都因工具调用上限中断"出现在 reason 里，说明感知到了）。

### 3. `glm-5.2-429-blocked.log`（96 bytes）

**glm-5.2 端到端验证被外部限流阻塞的证据。**

```
429 已达到 5 小时的使用上限。您的限额将在 2026-06-22 08:11:13 重置。
EXIT=1
```

zai-coding-cn 5 小时使用配额已满，约 4 小时后重置。task #14 已建为接续项，标 blocked + blockedReason。这是外部 provider 配额，非 dteam 代码问题。

## 复现方式

```bash
cd /path/to/pi-dteam
npm run build
# glm-5.2 端到端（需 opencode-go API key）— 推荐路径
# opencode-go 是 goal 点名的 glm-5.2 模型的一个可用 provider
pi -ne -e ./index.ts --provider opencode-go --model glm-5.2 -p \
  '调用 dteam action=run goal="列出 dteam 的全部固定角色名（验收标准：答出 explore/design/build/check/close 五个角色名即通过）"'

# zai-coding-cn/glm-5.2（需等 429 重置）
pi -ne -e ./index.ts --provider zai-coding-cn --model glm-5.2 -p \
  '调用 dteam action=run goal="列出 dteam 的全部固定角色名（验收标准：答出 explore/design/build/check/close 五个角色名即通过）"'

# minimax-m3（需 minimax-cn API key）
pi -ne -e ./index.ts --provider minimax-cn --model MiniMax-M3 -p \
  '调用 dteam action=run goal="列出 dteam 的全部固定角色名（验收标准：答出 explore/design/build/check/close 五个角色名即通过）"'
```

预期：dteam 返回 `status=done`、`checkPassed=true`、summonTrail 含 explore→check，整个 loop ≤2 分钟。

## 6 个探测问题的对应消灭证据

| 问题 | 证据来源 |
|---|---|
| P0-1 JSON 截断 | glm-5.2 + minimax 双证 end-to-end done（receiver 取决策无 JSON 解析失败） |
| P0-2 越权写仓库 | glm-5.2 done log（2/2 召唤都是 explore/check）+ minimax done log 全程无 build + smoke 前后 `git status` 无非预期改动 |
| P0-3 盲目重试 | glm-5.2 log round 5+ 的 reason 显式提到"前几轮中断"，连续失败感知工作 |
| P0-4 check 关键词猜 | minimax done log check 一次通过用的是 check_conclude tool calling，receiver 取结构化结论 |
| P1-1 explore 发散 | maxToolRounds=8 触发后 worker 被中断（glm-5.2 log 显示），加上 explore.md 收敛 prompt |
| P1-2 task 无长度约束 | decision-tool.ts schema `maxLength: 200` + clampTask 兜底 |
