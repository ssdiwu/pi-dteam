# 与 pi-context-manager 对比

> 调研记录。本节只做范式对比和"轻 / 重"评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](./项目路线图.md)**。

- 来源：[https://pi.dev/packages/pi-context-manager](https://pi.dev/packages/pi-context-manager)
- v0.1.2，**1.2 MB**（这批调研里最大）
- 126 下载/月
- 作者：lain-residue（npm: catlain）
- 借鉴参考：ant-colony

## 一句话

pi-context-manager 是个**上下文窗口管理子系统**：tool result 格式化 + 蒸馏（distillation）+ 老化（aging）+ TUI 侧栏 + payload 录制。给"长 session 的 context 优化"用的。

## 核心机制

### Tool result 处理链

当工具返回结果时，pi-context 跑一个 formatter 链：

1. Web search → 提取 titles/URLs/summaries，去掉 boilerplate
2. GitHub → 压缩 issue/PR/commit 数据
3. Web reader → 截断大页面，提取关键内容
4. Bash → strip ANSI 码，截断长输出
5. MCP error → 清理冗长错误堆栈

### Distillation（蒸馏）

处理后，把老 tool result 替换为 compact summary。配置哪些工具要蒸馏、保留规则（`/distill-config`）。

### Context aging（老化）

超过阈值的消息标记为可压缩（`/aging-config`）。

### Context panel（TUI）

侧栏显示 context 用量、distillation 统计、消息元数据（`/context`）。

### Payload recording

记录 provider payloads 用于调试 token 用量（`/record on/off`）。

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> **轻**：单点代码（5-10 行）
> **重**：整套子系统（1.2MB）
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。

**pi-context-manager 1.2MB 是重**。**整套不集成**。

但**有 2 个轻动作可以单点借**（5-10 行代码，0 依赖）：

### 借用 1：leaf 截断超过 N 字节的 tool result

- 文件：`src/leaf.ts` 或 `src/leaf/extract.ts`
- 改动量：5-10 行
- 价值：leaf 跑长任务时 context 不爆
- 思路：在 `session.messages` 提取文本时，对 `tool_result` 类型 content 做字节截断

### 借用 2：leaf 处理 bash 输出时 strip ANSI 码

- 文件：`src/leaf/extract.ts`（或新增 `src/leaf/ansi-strip.ts`）
- 改动量：5-10 行
- 价值：bash 输出干净，token 节省
- 思路：用 ANSI 正则 `/\x1b\[[0-9;]*m/g` 替换为空字符串

## 与 dteam 的关系

dteam 的 leaf 跑长任务，context 会爆。当前 dteam **没有** context 管理，靠的是 `createAgentSession` 的 compaction 配置（`compaction: { enabled: false }`，即不主动压缩）。

dteam 跑短平快任务（单 goal、单 plan、单 run）通常不会爆 context。但**长 chain**（10+ 步） + **多 worker team** 模式 + **build 角色**（写文件 + 跑测试输出）容易让 context 爆。

## 借鉴清单

| 项 | 范围 | 状态 | 备注 |
|----|------|------|------|
| 截断 tool result | 0.4.1~0.4.3 | 待定 | 单点 5-10 行 |
| strip bash ANSI | 0.4.1~0.4.3 | 待定 | 单点 5-10 行 |
| 整套集成 | 远期 | 暂不做 | 1.2MB 太重 |

## 不要学

- ❌ distillation（替换老 tool result 为 summary）—— dteam 跑短平快，蒸馏逻辑不划算
- ❌ aging 规则（标记老消息为可压缩）—— 同上
- ❌ TUI context panel（侧栏）—— dteam 已有 `src/ui/panel.ts`，再加侧栏是 UI 重叠
- ❌ payload recording（写盘）—— dteam 轻量化不做
- ❌ 配置驱动（`/distill-config` 等命令）—— dteam 配置在 `src/config.ts` 集中管理，不做命令式配置

## 关键不变量（dteam 必须保留）

1. **`compaction: { enabled: false }`** —— dteam 不主动压缩 context，靠 in-process session 短平快
2. **配置集中在 `src/config.ts`** —— 不引入新的命令式配置入口
3. **单 UI 层（`src/ui/`）** —— 不增加 context panel

## 参考实现位置

- npm 包：`pi-context-manager`
- GitHub：github.com/catlain/pi-context
- 关键文件：
  - `processors/bash.ts`（ANSI stripping + truncation）
  - `processors/web-reader.ts`（页面截断）
  - `distill.ts`（蒸馏引擎，**不学**）
