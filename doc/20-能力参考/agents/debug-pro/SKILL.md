---
name: debug-pro
slug: debug-pro
version: 0.1.0
description: >
  当主要任务是复现、定位和解释 bug 或失败行为时，运行系统化的调试工作流。当用户更倾向于根因调查而非功能实现或编写测试时触发。
triggers:
  - debug this failure
  - isolate the root cause
  - reproduce and investigate a bug
  - explain why this behavior breaks
not_when:
  - implement a feature as the main task
  - add or run tests as the main task
  - perform security review as the main task
  - do generic web research or browsing
family: engineering
dependencies:
  tools:
    - exec_command
  local_files:
    - /Users/diwu/.agents/skills/debug-pro/references/debug-loop.md
  services: []
---

# Debug Pro（专业调试）

## 目的

提供专用的 Bug 调查通道，在修复之前完成复现、定位和根因验证。

## 适用场景

- 用户要求调试 bug、失败行为或无法解释的回归问题。
- 首要需求是复现和根因定位，而非实现。
- 失败涉及对问题实际位置的判断不确定性。
- 用户希望有纪律的调试循环，而非临时猜测。

边界示例：

- 如果用户说「修复这个功能」，使用 `code-workflow`；如果说「搞清楚为什么这里会失败」，则使用本技能。

## 不适用场景

- 任务明显以实现为首要目标。
- 任务明确以测试为主要产出物；应使用 `test-runner`。
- 任务聚焦安全；应使用 `security-auditor`。
- 无需实际调试即可从静态知识给出答案。

## 输入 / 输出

- 输入：失败症状、复现上下文、日志、命令及任何可疑区域。
- 输出：复现状态、缩小的根因或当前最佳假设、收集到的证据，以及最小下一步修复或实验方案。

## 工作流程

**核心心智：有没有一个快速、确定性、agent 能跑的 pass/fail（成败）信号，决定能不能找到 bug。** 这个信号就是「反馈环」——它就是调试本身，其余都是机械操作。有环，bug 已修了 90%；没有环，盯代码看再久也白搭。

为反馈环投入不成比例的精力。建环手段见 `references/debug-loop.md`，失败测试、curl 脚本、CLI+fixture、headless 浏览器、重放 trace、throwaway harness、fuzz、bisect、差分对比、HITL 脚本——按这个顺序试，主动、有创意、别轻易放弃。

有了环之后，六阶段（跳过任何阶段必须显式说明理由）：

1. **建反馈环**（以上）。把环当产品迭代：更快？信号更准（断言具体症状而非「没崩」）？更确定性（固定时间/seed RNG/隔离文件系统/冻结网络）？30 秒的 flaky 环≈没环，2 秒的确定性环是超能力。**建不出环就停下求助**：列出试过的方法，请用户提供复现环境 / 捕获产物（HAR、日志、core dump、带时间戳录屏）/ 允许加临时生产插桩——别在没有环的情况下空猜。
2. **复现**：跑环，确认复现的是**用户描述的那个 bug**而非邻近 bug（错的 bug=错的修复）；非确定性 bug 的目标不是「干净复现」而是「更高复现率」（loop 100 次、并行、加压、缩窄时间窗、注入 sleep，把 1% flaky 拉到可调试）。
3. **假设**：**一次性生成 3-5 个排序假设**再测，避免锚定第一个貌似合理的想法；每个假设必须**可证伪**——「若 X 是原因，则改 Y 会让 bug 消失 / 改 Z 会让它更严重」，说不出预测的就是 vibe（凭感觉），扔掉。把排序假设给用户看一眼（领域知识常能瞬间重排），用户 AFK 就用自己的排序继续。
4. **插桩**：每个探针对应一个假设，**一次只改一个变量**；优先用 debugger/REPL 断点（一个断点胜过十条日志），其次边界定向日志，**永远别「全打日志再 grep」**；所有 debug 日志打唯一 tag（如 `[DEBUG-a4f2]`），结尾一个 grep 全删。**性能回归走另一路**：日志通常没用，先建基线测量（计时/profiler/query plan）再 bisect。
5. **修+回归**：回归测试**先写**（红），但**仅当存在正确接缝**——测试在真实 bug 模式发生的调用点；若只能写浅测试锁不住 bug，**「没有正确接缝」本身就是发现**（架构阻止了 bug 被锁定），记下来交给 `architecture-designer`。
6. **清理+复盘**：复现消失、回归通过、删干净所有 `[DEBUG-...]` 插桩、删 throwaway 原型、commit 写明哪个假设对了（让下一个调试者受益）；最后问「什么能预防这个 bug」，涉及架构改动就交 `architecture-designer`，**在修复之后而非之前**问（现在信息最全）。

## 参考资源

- `references/debug-loop.md`：六阶段循环 + 10 种建环手段 + 可证伪假设格式 + tag 纪律 + 接缝信号。
- `references/hitl-loop.template.sh`：最后手段——必须人工点击时的结构化复现脚本，捕获输出回传给 agent。
