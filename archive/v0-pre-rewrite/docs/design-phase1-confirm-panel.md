# 设计文档：两段式执行 + 确认面板

> 版本: v0.1 | 日期: 2026-06-03 | 状态: 待评审

---

## 一、总览

### 1.1 核心问题

当前 dteam 使用方式是手动分步操作（手动 create/start 每个 worker），`dteam run` 虽然存在但只是硬编码角色链一口气跑，不好用。

### 1.2 目标形态

变成**两段式半自动**：

```
用户说一句话
    ↓
┌─ Phase 1: 自动编排（无人值守）──────────┐
│  explore → design → 写 .md → 弹确认面板   │
└────────────────────┬─────────────────────┘
                     │
               ⏸ 停在这里等你确认
               （看 / 改 / Enter / 跳过 / 取消）
                     │
┌─ Phase 2: 自动执行（无人值守）───────────┐
│  build → check → close                  │
│  (help 时按需插入 explore)                │
│  跑完汇报结果                             │
└──────────────────────────────────────────┘
```

### 1.3 与蚁群的关键区别

| 维度 | 蚁群 (ant-colony) | dteam (新设计) |
|------|-------------------|---------------|
| 自主性 | 全自动闭环 | 半自动（中间停一下） |
| 介入点 | 仅 stop/resume | 可审核/修改计划 |
| 计划可见性 | 无（内部任务池） | .md 文件 + TUI 面板 |
| 适用场景 | 目标清晰、可全托管 | 目标模糊、需要人把关 |

---

## 二、Phase 1：自动编排

### 2.1 执行流程

```
dteam run(goal)
    ↓
① spawn explore worker（chain 第 1 步）
   task: "探路：<goal>"
   → 读代码、找文件、分析依赖、识别风险
   → 结果写入共享内存 (namespace: "plan", key: "explore-findings")
   
② spawn design worker（chain 第 2 步，依赖 ①）
   task: "基于探索结果，设计执行方案：<goal>"
   → systemPrompt 注入 explore-findings
   → 产出 .dteam/task/<id>.md（现有 task 格式）
     ├── 基本信息（ID / 类型 / 时间 / 状态）
     ├── Goal（为什么 + 做什么）
     ├── 范围（包含 / 排除）
     └── 验收条件（GWT checklist ← 面板数据源）

③ 解析 .md 提取 checklist
   → 从「验收条件」section 解析出待办项列表
   
④ 弹出确认面板 ◀── 阻塞等待用户操作
```

### 2.2 容错机制

```
explore 或 design 失败？
    ↓
自动重试 1 次（同参数重新 spawn）
    ↓
还失败？
    ↓
┌──────────────────────────┐
│ 面板照弹，但显示错误信息   │
│ ☐ ❌ 探路失败：超时        │
│ ☐ ❌ 无法生成有效计划      │
│                          │
│ [r] 重试  [Esc] 取消      │
└──────────────────────────┘
```

### 2.3 共享内存约定（Phase 1 → Phase 2 交接）

| namespace | key | 内容 | 写入方 | 读取方 |
|-----------|-----|------|--------|--------|
| `plan` | `explore-findings` | 探路结果文本（≤6000字） | explore worker | design worker |
| `plan` | `task-path` | 产出的 .md 文件路径 | P3 编排器 | 面板 + Phase 2 |
| `plan` | `goal` | 用户原始目标 | P4 入口 | design worker |

---

## 三、确认面板（UI 设计）

### 3.1 触发时机

- **触发者**: `dteam run` 的 Phase 1 完成后自动弹出
- **不是**: `/dteam` 命令（该命令保留原有用途：查看运行中 worker 进度）
- **条件**: Phase 1 成功产出 .md 或重试后失败

### 3.2 渲染方式

复用现有 `worker-widget.ts` 的面板基础设施：

```typescript
// 复用现有模式
ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
  // Box + aboveEditor placement（与现有 Tab 面板相同）
}, { placement: "aboveEditor" });
```

### 3.3 面板布局

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  📋 执行计划 · JWT 认证                            │  ← 标题行：icon + goal 摘要
│  ─────────────────────────────────────────────── │
│  Goal: 实现基于 JWT 的登录注册认证                   │  ← 目标全文（截断）
│                                                  │
│  ☐ AC-1: 工具调用只显示一行概要                     │  ← checklist 来自 .md 验收条件
│  ☐ AC-2: 错误态以 ❌ 或 ✗ 显示                     │
│  ☑ AC-3: 流式态显示 ⏳ Processing...              │  ← Phase 1 已完成的项自动勾选
│  ☐ AC-4: 展开态提示快捷键                          │
│  ☐ AC-5: ctrl+o 展开详情                          │
│  ...                                             │
│                                                  │
│  📄 .dteam/task/20260603-xxx.md            [e] 编辑 │  ← 文件路径 + 编辑入口
│                                                  │
│  ─────────────────────────────────────────────── │
│  [Enter] 确认执行  [⏭S] 跳过确认  [Esc] 取消       │  ← 操作栏
│                                                  │
└──────────────────────────────────────────────────┘
```

### 3.4 三种状态的面板变体

#### 正常状态（Phase 1 成功）

如上图。展示完整 checklist。

#### 重试失败状态（Phase 1 失败且重试也失败）

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  📋 执行计划 · JWT 认证                            │
│  ─────────────────────────────────────────────── │
│  ⚠️ Phase 1 编排遇到问题                           │
│                                                  │
│  ❌ 探路阶段失败：请求超时 (retry 1/1)              │
│  ❌ 无法生成有效计划                               │
│                                                  │
│  📄 日志: .dteam/spawn/xxx/error.md               │
│                                                  │
│  ─────────────────────────────────────────────── │
│  [r] 重试 Phase 1  [Esc] 取消                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### 跳过确认后的状态（⏭S）

面板直接关闭，不阻塞。Phase 2 立即启动。日志里记录 `"confirm: skipped"`。

### 3.5 交互操作表

| 操作 | 快捷键 | 行为 | 后续 |
|------|--------|------|------|
| 确认执行 | `Enter` | 关闭面板，启动 Phase 2 | Phase 2 开始跑 |
| 跳过确认 | `⏭S` | 关闭面板，启动 Phase 2（同 confirm 但跳过后续同类目标的确认） | Phase 2 开始跑 |
| 取消 | `Esc` / `q` / `Ctrl+C` | 关闭面板，终止 | 清理临时文件，返回 `{ cancelled: true }` |
| 编辑 .md | `e` | 关闭面板，打开 .md 文件供编辑 | 用户需重新触发 dteam run（或后续支持"从已有 plan 继续"） |
| 重试 | `r`（仅失败态） | 重新跑 Phase 1 | 回到 ②③④ |

> **MVP 范围**：第一版只实现 Enter / ⏭S / Esc 三种操作。e 和 r 后续迭代。

### 3.6 返回值契约

面板通过 `done(result)` 向外传递用户选择：

```typescript
type ConfirmResult =
  | { action: "confirm"; taskPath: string }     // Enter: 确认，附带 .md 路径
  | { action: "skip"; taskPath: string }         // ⏭S: 跳过
  | { action: "cancel" }                        // Esc: 取消
  | { action: "retry" };                        // r: 重试（仅失败态）
```

P3/P4 编排器根据 result 决定下一步。

### 3.7 与现有面板的关系

| | 现有 Tab 面板 (`showWorkerPanel`) | 新确认面板 (`showConfirmPanel`) |
|--|----------------------------------|-------------------------------|
| 触发 | `/dteam` 命令手动触发 | `dteam run` Phase 1 完成自动触发 |
| 数据源 | WorkerProgressStore（运行中的 worker） | .dteam/task/*.md 文件（静态计划） |
| 主要操作 | 查看 / 切换 tab / 进子 worker | 确认 / 跳过 / 取消 |
| 生命周期 | 可反复开关（toggle） | 一次性（操作后即销毁） |
| 复用组件 | Box / Text / Key / matchesKey | 全部复用 |

两者共存，互不冲突。确认面板是一次性的 overlay，操作后消失；Tab 面板是常驻的进度查看器。

---

## 四、Phase 2：自动执行

### 4.1 执行流程

```
用户按 Enter 确认（或 ⏭S 跳过）
    ↓
读取 .dteam/task/<id>.md 的验收条件 checklist
    ↓
构建 chain:
  step 1: build worker  — 执行主要编码工作
  step 2: check worker  — 验证（tsc / test / 人工检查点）
  step 3: close worker  — 收口归档（git commit / README / 总结）
    ↓
后台启动 chain（background=true）
    ↓
执行过程中:
  ├─ 正常 → 逐项完成 checklist
  ├─ worker 发出 help 信号 → 按需插入 explore worker 补充信息 → 继续执行
  ├─ worker 发出 blocked 信号 → 重试 / 报告（暂不自动终止，让链跑完）
  └─ 全部完成 → 汇报结果到聊天流
```

### 4.2 Checklist 驱动

Phase 2 的每个 worker 完成后，对应更新 .md 中的 checklist：

```markdown
## 验收条件
- [x] AC-1: 工具只显示一行概要          ← build 完成后打勾
- [x] AC-2: 错误态视觉区分              ← build 完成后打勾
- [ ] AC-3: 流式态显示                 ← 待做
...
```

最终汇报时，这个 checklist 就是**验收报告**。

### 4.3 二次 explore 触发条件

```
build worker 执行中
    ↓
发现缺少关键信息 / 遇到无法独立解决的问题
    ↓
bus.emit("help", workerId, { reason: "缺 xxx 模块的接口定义" })
    ↓
P3 编排器捕获 help 信号
    ↓
插入一个 explore worker（轻量，maxTurns 较小）
    ↓
explore 结果追加到共享内存
    ↓
原 build worker 或后续 worker 继续执行
```

**不做**：无条件每次 build 后都跑 explore（浪费）。
**不做**：blocked 也自动插 explore（blocked 可能是权限/网络问题，探路解决不了）。

### 4.4 Phase 2 不做的事

| 不做 | 原因 |
|------|------|
| deploy | 风险高、需要凭证、不适合自动化；需要时手动跑 |
| soldier 审查循环 | check 角色覆盖了；审查循环可后续加 |
| 预算控制 | 当前无 cost 追踪；后续可加 |
| 断点续传 | 当前单次执行；后续可基于 .md 实现 resume |

---

## 五、数据流全景

```
用户输入
  │
  ▼
┌─────────────┐
│ P4 入口      │  dteam tool: run(goal)
│ dteamTool.ts │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ P3 编排器    │────▶│ Phase 1      │────▶│ 共享内存     │
│             │     │              │     │             │
│ ① 构建 chain│     │ ① explore   │     │ plan:       │
│ ② 启动 Phase1│     │ ② design    │     │ -findings   │
│ ③ 等面板结果 │     │ ③ 写 .md    │     │ -task-path  │
│ ④ 启动 Phase2│     │ ④ 解析 checklist│   │ -goal       │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼────────┐
                    │ P4 确认面板    │
                    │              │
                    │ 读 .md        │
                    │ 渲染 checklist│
                    │ 等用户操作     │
                    │ done(result)  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ confirm  │ │ skip     │ │ cancel   │
        │ Phase 2  │ │ Phase 2  │ │ 清理     │
        └─────┬────┘ └─────┬────┘ └──────────┘
              │            │
              ▼            ▼
        ┌─────────────────────┐
        │ Phase 2 执行          │
        │                     │
        │ build→check→close   │
        │   ↑ help→explore(按需)│
        │                     │
        │ 更新 .md checklist   │
        │ 汇报结果             │
        └─────────────────────┘
```

---

## 六、文件改动范围（预判）

### 需要新建的文件

| 文件 | 层 | 职责 |
|------|-----|------|
| `src/P4/confirmPanel.ts` | P4 | 确认面板 UI 组件（渲染 + 交互） |
| `docs/design-phase1-confirm-panel.md` | docs | 本文档 |

### 需要改动的文件

| 文件 | 改什么 |
|------|--------|
| `src/P4/dteamTool.ts` | `executeRun()` 拆成两段式：Phase 1 → 面板 → Phase 2 |
| `src/P3/worker.ts` 或新建 `src/P3/orchestrator.ts` | Phase 1 chain 构建 + Phase 2 chain 构建逻辑 |
| `src/P4/worker-widget.ts` | 新增 `showConfirmPanel()` 函数（复用现有 Box/Key 基础设施） |
| `src/P4/index.ts` | 注册面板相关的快捷键/命令（如果需要） |
| `src/P1/spawn.ts` | 可能微调：Phase 1 的 explore/design worker 自动 emit 信号 |

### 不需要改动的文件

| 文件 | 原因 |
|------|------|
| `src/P0/*` | 类型层不变 |
| `src/P1/signalBus.ts` | 信号总线不变 |
| `src/P1/signalLog.ts` | 信号日志不变 |
| `src/P1/enhancedSharedMemory.ts` | 共享内存不变（复用现有 namespace） |
| `src/P2/solo.ts` / `chain.ts` / `team.ts` | 执行模式不变，P3 组合调用 |
| `src/P2/contextBuilder.ts` | 上下文构建不变 |

---

## 七、开放问题（留后续讨论）

1. **⏭S 跳过的记忆**：用户本次按了 ⏭S 跳过确认，下次同类型目标是否默认跳过？（偏好存储？）
2. **[e] 编辑后的继续**：用户在面板中按 e 编辑了 .md 后，如何无缝回到"确认"流程？（重新读 .md 重新弹面板？）
3. **Phase 2 执行中的实时面板**：Phase 2 跑的时候，能否在现有 Tab 面板里增加一个"计划 vs 实时进度"的对照视图？（checklist 实时打勾）
4. **多目标并行**：同时跑多个 dteam run 时，确认面板如何排队或合并？

---

## 八、术语表

| 术语 | 定义 |
|------|------|
| Phase 1 | 自动编排阶段：explore + design + 写 .md + 弹面板 |
| Phase 2 | 自动执行阶段：build + check + close（help 时按需 explore） |
| 确认面板 | Phase 1 结束后弹出的 TUI 内联 overlay，展示 checklist 等 user 操作 |
| 充分度 | 目标是否足够具体、是否有足够上下文直接执行（影响是否默认弹面板） |
| checklist | .md 中「验收条件」section 的 GWT 条目列表，面板数据源 + Phase 2 驱动列表 |
