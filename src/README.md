# dteam 内部架构

> 先读 `../README.md` 看用户视角，再读这个看实现细节。

## 文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `tools.ts` | 110+ | 类型定义（Task/Decision/ExecutionPlan/RunResult/StepResult/FileGraph/SchedulingPlan） |
| `pool.ts` | 80 | 任务池（write/claimNext/update/getAll/count） |
| `planner.ts` | 200+ | Phase 1: 规则判断 + LLM 兜底生成计划 |
| `leaf.ts` | 60 | 用角色调 LLM 执行一个 step |
| `session.ts` | 200+ | createWorkerSession 工厂 + 角色系统 + 模型选择 |
| `planner.ts` | 200+ | Phase 1: 规则判断 + LLM 兜底 |
| `orchestrator.ts` | 230+ | 主循环：plan → execute → report |
| `ui/store.ts` | 160+ | UI 全局状态（workers/strategies/signals + 0.5 mode/scheduling 契约） |
| `ui/panel.ts` | 328 | overlay 面板 + 折叠态 widget |
| `ui/index.ts` | 12 | 统一导出 |

## 数据流

```
goal (string)
  ↓
planner.plan(goal, ctx)
  ↓
ExecutionPlan { mode, steps: [{ role, task, strategy }] }
  ↓
orchestrator.run(plan, ctx)
  │
  ├─ solo  → runStep(steps[0])
  ├─ chain → runStep(steps[0]) → runStep(steps[1], prev=...) → ...
  └─ team  → Promise.all([runStep(s1), runStep(s2), runStep(s3)])
  │
  └─ runStep: 按 strategy 分发
       ├─ direct      → leaf.execute(role, task, ctx, goal)
       ├─ build_check → build→check 循环（最多 3 轮）
       └─ adaptive    → 执行→评估 循环（最多 5 轮）
  ↓
StepResult[] → RunResult
  ↓
content (JSON string) → 返回给 LLM
```

## 关键不变量

1. **build 唯一能改代码**：`getRoleTools("build")` 包含 edit，其他角色不包含
2. **team 并发 ≤ 3**：避免撞 API 限流
3. **build_check ≤ 3 轮 / adaptive ≤ 5 轮**：防止死循环
4. **chain 失败即终止**：保留已完成结果，不再执行后续 step
5. **session.prompt 抛错向上传**：step 标记 failed，orchestrator 不 catch

## 设计决策记录

| 决策 | 为什么 |
|------|--------|
| createAgentSession 而非 completeSimple | 走 auth.json 解析 API key |
| customTools 传 decide 工具 | tools 是内置工具名列表，customTools 才是自定义工具 |
| pickAvailableModel 加 fallback | Pi 里 M3 偶尔找不到时能降级到 M2.7 |
| 规则判断优先于 LLM | 零成本，95% 简单目标不需要 LLM |
| JSON 模式而非 tool calling | MiniMax-M3 tool calling 不稳定 |
| 工具加载从白名单变主 LLM 显式传入 | 见 `../doc/90-归档/版本实施方案/41-工具动态加载方案.md` 方案 D；0.4.0 `ROLE_DEFAULTS` 仍为 fallback（主 LLM 不传 availableTools 时走 ROLE_DEFAULTS） |
| prevOutput 字符串注入 | v0 的 withPreviousOutput 简化版，不引入共享内存 |
| team 分批 ≤ 3 | 撞 429 风险 vs 并行收益的平衡 |
| 测试用 vitest + vi.mock | 已有项目实践，ESM 友好 |

## 0.5.0 契约占位

Phase 0 已冻结以下类型 / 状态边界，后续阶段逐步填充真实数据：

- `FileGraph` / `SchedulingPlan` / `SchedulingConflict`：定义在 `tools.ts`
- `RunResult.fileGraph` / `RunResult.scheduling`：最终 report 可回溯入口
- `StepResult.files`：step 级文件边界
- `UIState.mode` / `UIState.planReason` / `UIState.scheduling`：运行态 UI 展示入口
- `DTEAM_CONFIG.scheduler`：shared file patterns、支持扩展名、扫描上限
- `Reporter.setPlan()` / `Reporter.setScheduling()`：业务层向 UI 层传递 plan / scheduling
- `src/scheduler/file-graph.ts`：已实现轻量 import graph
- `src/scheduler/preflight.ts`：已实现 hard/shared/dependency/unknown conflict 分类与 batch 生成

当前阶段**尚未接入 orchestrator**；调度只在 scheduler 模块和单测中生效。

## 扩展点

| 想改什么 | 改哪里 |
|---------|--------|
| 加新角色 | `tools.ts` RoleName + `session.ts` ROLE_DEFAULTS + `agents/{role}.md` + `planner.ts` normalizeRole |
| 改 planner 规则 | `planner.ts` quickRuleBasedPlan |
| 改主模型 | `leaf.ts` / `planner.ts` / `session/model-resolver.ts` 的模型选择逻辑 |
| 加新策略 | `tools.ts` Strategy + `orchestrator.ts` runStep 新增 case |
| 改工具可用列表来源 | dteam 工具 schema 的 `availableTools` 参数（主 LLM 调时传） |
| 改 UI | `ui/panel.ts`（overlay 面板）/ `ui/store.ts`（状态） |

## 已知限制

- **planner 规则只能识别中文关键词**：英文 goal 会 fallback 到 LLM
- **M3 模型可能找不到**：自动降级到 M2.7，但会打印 `console.error` 警告
- **build_check 的 check 输出是文本**：靠正则匹配 "通过/pass/✓" 判断，可能误判
- **adaptive 的评估也是文本**：靠正则匹配 "满意/完成"，主观性强
- **没接 stream 回调**：leaf 看不到 LLM 实时输出，UI 只显示最终结果
- **工具动态加载已在 0.4.1 落地**：不传 `availableTools` 时仍走 `ROLE_DEFAULTS[role].tools`；planner LLM 路径支持主 LLM 传 `availableTools` 参数（dtool schema），不传则走 ROLE_DEFAULTS（见 `../doc/90-归档/版本实施方案/41-工具动态加载方案.md` 方案 D）
