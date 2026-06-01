# 实施-自动编排-task→chain-plan

## 基本信息
- ID: 20260601182644-dcs3
- 类型: infra
- 创建时间: 2026-06-01T10:26:44.916Z
- 状态: todo

## 目标
- 为什么: dteam 当前 task Markdown 是"用户的契约"，但用户写完 task 后还是要手动 /build /check。subagents 的 chain 工具让父 LLM 自己规划步骤并执行。dteam 缺"task Markdown 解析 → chain plan → 自动执行"这条路径，task 的潜力没发挥。
- 做什么: 实现 task Markdown 到 chain plan 的解析器：读 task 的"目标/范围/验收条件/阶段记录"section，结合 dteam 角色库，自动生成"explore→design→build→check→close"的 chain plan，喂给 worker_start 执行。

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）## 验收条件（GWT + 测试）

- [ ] AC1 P3/chainPlanner.ts 实现：接受 task id 输出 ChainPlan
- [ ] AC2 5 种类型对应：refactor / bugfix / infra / functional / ui 各有默认 plan
- [ ] AC3 plan 包含：每个 step 的 agent 角色、mode（solo/team/chain）、task 描述、依赖
- [ ] AC4 TUI 预览：plan 生成后支持用户调整（增删 step、改 agent 角色）
- [ ] AC5 与调度入口集成：dteam(action=plan) 调用 chainPlanner
- [ ] AC6 测试：单测 5 种类型；`npm test` 不回归
- [ ] AC7 契约文档：与调度入口、chain 模式的边界写入 task「阶段记录→讨论决策」section

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
��记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
