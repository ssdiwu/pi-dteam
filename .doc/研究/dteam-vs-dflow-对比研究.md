---
title: "dteam vs dflow 对比研究"
kind: research
domain: 研究
status: stable
tags: [dteam, dflow, 对比, 研究]
created: 2026-05-30
updated: 2026-05-30
---

# dteam vs dflow 对比研究

## 一、研究背景

dteam 是一个轻量级的多代理编排系统，旨在简化 dflow 的复杂流程。本研究对比 dteam 和 dflow 的核心功能差异，分析 dteam 的设计理念和优势。

## 二、核心概念对比

### 2.1 工作主语

| 维度 | dteam | dflow |
|------|-------|-------|
| **工作主语** | task（简化） | dfeat（复杂） |
| **存储格式** | Markdown | TOML |
| **状态** | 6 个（pending/running/blocked/done/failed/cancelled） | 8 个（InDraft/InSpec/Ready/InProgress/InReview/Done/Blocked/Cancelled） |

### 2.2 执行单元

| 维度 | dteam | dflow |
|------|-------|-------|
| **执行单元** | worker（solo/chain/team） | single/chain/dteam |
| **执行模式** | 3 种（solo/chain/team） | 3 种（single/chain/dteam） |
| **并发控制** | ✅ 已实现（concurrency） | ✅ 已实现 |

### 2.3 角色系统

| 维度 | dteam | dflow |
|------|-------|-------|
| **角色数量** | 5 个（explore/design/build/check/close） | 12 个 agent |
| **角色定义** | agents/ 目录 | agents/ 目录 |
| **角色职责** | 明确分工 | 复杂分工 |

### 2.4 信号机制

| 维度 | dteam | dflow |
|------|-------|-------|
| **信号类型** | 4 个（progress/blocked/found/help） | 4 个（progress/blocked/found/help） |
| **信号策略** | 5 个（retry/adjust/switch/replan/learn） | 5 个（retry/adjust/switch/replan/learn） |
| **信号总线** | ✅ 已实现（SignalBus） | ✅ 已实现 |

## 三、工具接口对比

### 3.1 任务管理

| 工具 | dteam | dflow |
|------|-------|-------|
| **创建** | task.create | dfeat.start |
| **读取** | task.read | dfeat.status |
| **更新** | task.update | dfeat.plan |
| **完成** | task.complete | dfeat.done |
| **归档** | task.archive | 无 |
| **列表** | task.list | 无 |
| **搜索** | task.search | 无 |

### 3.2 执行控制

| 工具 | dteam | dflow |
|------|-------|-------|
| **创建** | worker.create | 无 |
| **启动** | worker.start | dteam.run |
| **信号** | worker.sendSignal | 无 |
| **取消** | worker.cancel | 无 |
| **状态** | worker.status | dstat |

### 3.3 参考查询

| 工具 | dteam | dflow |
|------|-------|-------|
| **架构类型** | reference.architecture | 无 |
| **思考方式** | 无 | thinking-styles.toml |

## 四、架构对比

### 4.1 分层架构

| 层级 | dteam | dflow |
|------|-------|-------|
| **P0 原子层** | status/signal/memory/config/i18n/loopDetector/concurrency/atomic/gateChecks/stateMachine | spawn/registry/toml/signalBus |
| **P1 分子层** | signalBus/sharedMemory/enhancedSharedMemory/backgroundWorker/i18n翻译 | 无（直接组合） |
| **P2 细胞层** | solo/chain/team/contextBuilder | single/chain/dteam/background |
| **P3 组织层** | worker 编排器 | 业务逻辑层（dfeat/dtask/pitfalls/gates/chains） |
| **P4 用户接口层** | prompts 定义 | index/renderers |

### 4.2 依赖方向

| 维度 | dteam | dflow |
|------|-------|-------|
| **依赖方向** | P0 → P1 → P2 → P3 | P3 → P2 → P1 → P0 |
| **依赖关系** | 清晰分层 | 混合依赖 |

## 五、使用体验对比

### 5.1 启动方式

| 维度 | dteam | dflow |
|------|-------|-------|
| **启动命令** | `/explore`、`/design`、`/build`、`/check`、`/close` | `dfeat start`、`dfeat plan`、`dfeat done` |
| **流程控制** | 简化（5步） | 复杂（dfeat/dtask/gates/chains） |

### 5.2 状态管理

| 维度 | dteam | dflow |
|------|-------|-------|
| **状态定义** | 6 个（pending/running/blocked/done/failed/cancelled） | 8 个（InDraft/InSpec/Ready/InProgress/InReview/Done/Blocked/Cancelled） |
| **状态转换** | 轻量级状态机 | 完整状态机 |

### 5.3 经验记录

| 维度 | dteam | dflow |
|------|-------|-------|
| **经验记录** | task 收口记录 | pitfalls 工具 |
| **经验查询** | task.search | pitfalls.query |

## 六、缺失功能分析

### 6.1 已补充的功能（3个）

1. ✅ **concurrency**：并发控制（最大并发数、超时控制）
2. ✅ **atomicCommit/Write**：原子提交（回滚机制）
3. ✅ **gateChecks**：门控检查（自动检查任务是否满足条件）

### 6.2 跳过的功能（13个）

1. ✅ **fusion**：多引擎融合（solo/chain/team 已足够）
2. ✅ **toml**：TOML解析（Markdown 已替代）
3. ✅ **registry**：注册表（目录管理已替代）
4. ✅ **dfeatIndex**：dfeat索引（基本查询已足够）
5. ✅ **summarize**：摘要生成（手动更新已足够）
6. ✅ **toolDiscovery**：工具发现（手动查询已足够）
7. ✅ **dfeat**：dfeat工作流（5步流程已覆盖）
8. ✅ **dtask**：dtask工作流（worker 已覆盖）
9. ✅ **compaction**：压缩（手动更新已足够）
10. ✅ **pitfalls**：经验库（任务级别记录已足够）
11. ✅ **stateMachine**：状态机（基本状态转换已足够）
12. ✅ **acceptanceEvidence**：验收证据（gateChecks 已覆盖）
13. ✅ **blockedMatrix**：阻塞矩阵（信号机制已足够）
14. ✅ **dtaskUpgrade**：dtask升级（task 已足够）
15. ✅ **dconfig**：配置管理（config 模块已足够）
16. ✅ **defaults**：默认配置（config 模块已足够）

## 七、核心差异总结

### 7.1 dteam 的优势

1. **简化流程**：5步流程 vs 复杂的 dfeat/dtask 流程
2. **统一接口**：task + worker 统一接口 vs 多个分散的工具
3. **分层架构**：P0-P3 清晰分层 vs 混合架构
4. **国际化**：11种语言 vs 无国际化
5. **循环防护**：内置循环检测器 vs 外部循环防护
6. **轻量级设计**：跳过不必要的功能，保持简洁

### 7.2 dflow 的优势

1. **功能完整**：12个 agent vs 5个角色
2. **踩坑记录**：pitfalls 工具 vs task 收口记录
3. **状态查询**：dstat 工具 vs worker.status
4. **成熟度**：已有大量测试和文档 vs 新项目

## 八、结论

dteam 是一个轻量级的多代理编排系统，它简化了 dflow 的复杂流程，提供了统一的接口和清晰的分层架构。虽然 dteam 缺少一些 dflow 的功能，但它通过跳过不必要的功能，保持了简洁和易用性。

dteam 适合以下场景：
1. 需要快速启动和执行的任务
2. 需要简化流程的项目
3. 需要国际化支持的项目
4. 需要循环防护的项目

dflow 适合以下场景：
1. 需要完整功能的项目
2. 需要复杂工作流的项目
3. 需要踩坑记录的项目
4. 需要成熟度的项目
