# dteam v1 vs ant-colony：能力差距分析

> 逐项对比，标注 dteam 缺什么、该不该补、优先级。

## 一、总览

| 模块 | ant-colony | dteam v1 | 差距 |
|------|-----------|----------|------|
| 调度核心 | queen.ts (958行) | orchestrator.ts (99行) | **大** |
| 任务池 | nest.ts (396行，文件持久化) | pool.ts (81行，纯内存) | 中 |
| 任务生成 | spawner.ts (384行) + parser.ts (200行) | brancher.ts (104行) | **大** |
| 并发 | concurrency.ts (126行) | 无 | **缺** |
| 依赖分析 | deps.ts (88行) | 无 | 缺 |
| UI | ui.ts (77行) + widget | ui-panel + ui-widget + ui-store | **dteam 更好** |
| 角色 | 4 caste (scout/worker/soldier/drone) | 5 role (explore/design/build/check/close) | dteam 多 |
| 信息素 | 完整 pheromone 系统 | 无 | 缺 |
| 容错 | 重试 + fallback model + 诊断任务 | 无 | **大** |

## 二、逐项差距分析

### 1. 调度策略：ant 有 4 阶段生命周期，dteam 只有一个 while 循环

**ant-colony**：
```
Phase 1: Scouting  → 派 scout 探路 → 收集情报
Phase 2: Planning  → 验证执行计划 → 不行就 recovery scout
Phase 3: Working   → 自适应并发派 worker → 子任务自动生成
Phase 4: Reviewing → 派 soldier 审查 → 有问题生成修复任务回到 Phase 3
```

**dteam v1**：
```
while (task = claimNext()) {
  decision = decide(task)  // 拆还是干
  if (decompose) → 写子任务回池
  if (execute)   → leaf 干活
}
```

**差距**：
- ❌ 没有先探索后执行的阶段分离（dteam 的 explore 角色没人派）
- ❌ 没有 review 阶段（dteam 的 check 角色没人派）
- ❌ 没有 plan 验证 + recovery（scout 输出不可执行时自动修复）
- ❌ 没有自动 tsc 检查

**优先级**：🔴 高 —— 这是蚁群的灵魂，dteam 现在只是个递归分解器

### 2. 多 Scout 投票（蚁群投票 quorum）

**ant-colony**：复杂目标派 2-3 个 scout 并行探索，结果投票合并
- 相同文件集的任务合并
- 被多 scout 提及的任务优先级提升

**dteam v1**：无

**优先级**：🟡 中 —— 对复杂任务有价值，但 v1 可先不做

### 3. 自适应并发

**ant-colony**：`concurrency.ts`
- 根据 CPU 负载、内存、吞吐量动态调节并发度
- 探索期逐步提升，找到最优值后微调
- 429 限流时自动退避 + 降并发

**dteam v1**：完全串行，一个任务一个任务排队

**优先级**：🟡 中 —— dteam v1 是同步阻塞模式，并发是 v2 的事

### 4. 容错与重试

**ant-colony**：
- 可重试错误（timeout/429/ECONNRESET）自动重试（最多 2 次）
- 429 渐进退避（2s → 5s → 10s）
- 模型 fallback 链（主模型挂了自动切备用）
- 僵尸任务清理（空描述/垃圾标题自动完成）
- 错误模式分类 + 自动生成诊断任务

**dteam v1**：失败直接标记 failed，不重试

**优先级**：🔴 高 —— 没有重试，网络一抖就全挂

### 5. 信息素系统

**ant-colony**：
- 6 种信息素：discovery / progress / warning / completion / dependency / repellent
- 信息素强度随时间衰减（10 分钟半衰期）
- 影响任务选择优先级
- 路径强化：成功完成的任务释放招募信息素

**dteam v1**：无

**优先级**：🟢 低 —— 这是高级优化，v1 不需要

### 6. 依赖分析

**ant-colony**：`deps.ts` —— 静态分析 TS/JS import graph
- 文件冲突检测（两个 worker 不能同时改同一个文件）
- 依赖感知调度（被依赖的文件先改）
- 任务阻塞/解锁（依赖文件改完才解锁）

**dteam v1**：无

**优先级**：🟡 中 —— dteam v1 串行执行不冲突，并发时才需要

### 7. 持久化 + 恢复

**ant-colony**：
- 状态写到 `.ant-colony/{colonyId}/` 目录
- `resumeColony()` 从检查点恢复
- claimed/active 任务重置为 pending
- 孤立 ant 标记为 failed

**dteam v1**：纯内存，进程挂了全丢

**优先级**：🟡 中 —— v1 同步阻塞不需要持久化，长任务时需要

### 8. 任务子生成

**ant-colony**：worker 完成后可以生成新任务
- 限制繁殖上限（最多 30 个任务，后期限制子任务数）
- 子任务文件冲突检测

**dteam v1**：brancher 可以生成子任务，但没有上限控制

**优先级**：🟡 中 —— 防止任务爆炸

### 9. 实时流式输出

**ant-colony**：`session.subscribe` 监听 text_delta，推给 onStream 回调

**dteam v1**：leaf 的 session 没有 subscribe，进度不可见

**优先级**：🔴 高 —— 用户看不到 worker 在干嘛

### 10. 角色 vs Caste

**ant-colony**：4 caste，通过不同 tools + systemPrompt 区分
- scout: 只读 + 探索
- worker: 全工具 + 执行
- soldier: 只读 + 审查
- drone: 纯 bash（零 LLM）

**dteam v1**：5 role，定义了但只用了 build
- explore: 只读 + 联网搜索（没人派）
- design: 只读 + 方案（没人派）
- build: 全工具 + 执行（leaf 用了）
- check: 只读 + 验收（没人派）
- close: 只写 + 归档（没人派）

**差距**：角色定义了但没有被调度使用

**优先级**：🔴 高 —— 这是刚才 507 提出的核心需求

## 三、总结：dteam v1 需要补的能力（按优先级）

### 🔴 P0（核心差距，影响可用性）

| # | 能力 | ant 有 | dteam 缺 | 工作量 |
|---|------|--------|---------|--------|
| 1 | **4 阶段调度**：scout → plan → worker → soldier | ✅ queen.ts | ❌ orchestrator | 大 |
| 2 | **角色调度**：根据阶段派不同角色 | ✅ caste | ❌ 只用 build | 中 |
| 3 | **重试 + fallback** | ✅ spawner.ts | ❌ | 中 |
| 4 | **实时流式输出** | ✅ session.subscribe | ❌ | 小 |

### 🟡 P1（重要但 v1 可忍）

| # | 能力 | 说明 |
|---|------|------|
| 5 | 任务上限控制 | 防止递归分解爆炸 |
| 6 | 模型 fallback 链 | MiniMax-M3 挂了能切备用 |
| 7 | 持久化 + 恢复 | 长任务断点续跑 |
| 8 | 依赖分析 + 文件锁 | 并发时才真正需要 |

### 🟢 P2（锦上添花）

| # | 能力 | 说明 |
|---|------|------|
| 9 | 信息素系统 | 高级优化 |
| 10 | 多 scout 投票 | 复杂目标 |
| 11 | 自适应并发 | v2 并行模式 |
| 12 | 错误模式诊断 | 自动修 bug |

## 四、建议的下一步

**最小代价补 P0 #1 + #2**：改造 orchestrator.ts，把"万能 while 循环"改成 4 阶段：

```
1. 探索阶段：派 explore 角色收集信息
2. 方案阶段：派 design 角色制定方案 + 验收条件
3. 执行阶段：派 build 角色执行（现有 leaf 逻辑）
4. 验收阶段：派 check 角色逐条验收
```

这不是重写，是在 orchestrator 的 while 循环前面加阶段控制。
