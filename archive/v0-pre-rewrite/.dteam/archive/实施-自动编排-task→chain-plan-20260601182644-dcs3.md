# 实施-自动编排-task→chain-plan

## 基本信息
- ID: 20260601182644-dcs3
- 类型: infra
- 创建时间: 2026-06-01T10:26:44.916Z
- 状态: todo

## 目标
- 为什么: dteam 当前 task Markdown 是"用户的契约"，但用户写完 task 后还是要手动 /build /check。
- 做什么: 实现 task Markdown 到 chain plan 的解析器，自动生成 explore→design→build→check→close 的 chain plan。

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）

- [x] AC1 P3/chainPlanner.ts 实现：接受 task id 输出 ChainPlan
- [x] AC2 5 种类型对应：refactor / bugfix / infra / functional / ui 各有默认 plan
- [x] AC3 plan 包含：每个 step 的 agent 角色、mode（solo/team/chain）、task 描述、依赖
- [ ] AC4 TUI 预览：plan 生成后支持用户调整（增删 step、改 agent 角色）
- [x] AC5 与调度入口集成：dteam(action=plan) 调用 chainPlanner
- [x] AC6 测试：单测 5 种类型；`npm test` 不回归
- [ ] AC7 契约文档：与调度入口、chain 模式的边界写入 task「阶段记录→讨论决策」section

## 阶段记录

### 探索发现

#### Task Markdown 结构

dteam task 文件包含以下 section：
- 基本信息：ID、类型、创建时间、状态
- 目标：为什么、做什么
- 范围：包含、排除
- 验收条件：GWT + 测试
- 阶段记录：探索发现、讨论决策、执行记录、收口记录

#### 角色默认链

根据 task 类型，默认链不同：
- `refactor`：explore → design → build → check → close
- `bugfix`：explore → build → check → close
- `infra`：explore → design → build → check → close
- `functional`：explore → build → check → close
- `ui`：explore → design → build → check → close

#### 与 bh4r 的关系

- bh4r 提供调度入口（dteam 工具）
- dcs3 提供自动编排（task → chain plan）
- dcs3 依赖 bh4r 的 dteam 工具作为执行入口

### 讨论决策

#### 实现方案

1. 新增 `src/P3/chainPlanner.ts`：解析 task Markdown 生成 chain plan
2. 集成到 bh4r 的 dteam 工具：action=plan 调用 chainPlanner

#### ChainPlan 结构

```typescript
interface ChainPlan {
  taskId: string;
  taskType: string;
  steps: ChainStep[];
}

interface ChainStep {
  role: string;
  mode: "solo" | "team" | "chain";
  task: string;
  dependsOn?: string[];
}
```

#### 解析逻辑

1. 读取 task 文件的「目标」和「验收条件」section
2. 根据 task 类型选择默认链模板
3. 为每个 step 生成 task 描述（从验收条件提取）
4. 设置依赖关系（串行步骤依赖前一步）

#### 与 dteam 工具集成

- `action=plan`：调用 chainPlanner 生成 plan，返回给用户预览
- `action=run`：接受 plan，按 plan 执行 worker_create + worker_start

### 执行记录

#### 2026-06-02 实施

**新增文件：**
- `src/P3/chainPlanner.ts`：task Markdown → ChainPlan 解析器
  - `generatePlan(content, filename)` — 从 Markdown 内容生成 ChainPlan
  - `planFromTaskId(cwd, taskId)` — 从 task id 读取文件并生成 ChainPlan
  - 5 种 task 类型各有默认链模板，未知类型 fallback 到 explore→build→check→close
  - 串行依赖：除第一步外都依赖前一步角色
  - 从验收条件提取与角色相关的条目作为 step 描述
- `tests/P3/chainPlanner.test.ts`：13 个单测覆盖 5 种类型、依赖关系、边界情况

**修改文件：**
- `src/P4/dteamTool.ts`：新增 taskId 参数，action=plan 优先从 taskId 生成 chain plan
- `src/P4/index.ts`：dteam 工具参数定义新增 taskId
- `src/P3/README.md`：模块清单、调用链、返回值、默认链模板表格

**测试结果：**
- `npm test`：16 个测试文件、185 个测试全部通过
- chainPlanner 13 个测试全部通过

**验收条件对照：**
- [x] AC1 P3/chainPlanner.ts 实现
- [x] AC2 5 种类型对应
- [x] AC3 plan 包含角色、mode、task、依赖
- [ ] AC4 TUI 预览 — 未实现，需后续 task
- [x] AC5 dteam(action=plan) 集成
- [x] AC6 测试覆盖
- [ ] AC7 契约文档 — 部分完成（README 已更新）

