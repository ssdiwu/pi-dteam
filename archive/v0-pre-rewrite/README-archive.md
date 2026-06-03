# v0-pre-rewrite 归档说明

> **状态**：已归档（archived）
> **归档时间**：2026-06-03
> **触发原因**：决定从第一性原理重写 dteam worker 引擎

## 为什么归档

经过 ant-colony vs dteam 终极对比，我们发现：

- 当前 `src/` 40+ 个 TS 文件虽然体量大，但**实际可运行的 worker 闭环极弱**
- `claimNextWorkItem` / `workItems[]` 状态机 / `signal -> state` / `help -> resume` 几乎都还在文档层
- 文档质量、协议完整度都显著高于 ant-colony，但实现完成度与文档之间存在巨大落差
- 继续修补不如重写

## 这次归档的内容

- `src/P0-原子层/`
- `src/P1-分子层/`
- `src/P2-细胞层/`
- `src/P3-组织层/`
- `src/P4-用户接口层/`
- `tests/unit/`
- `tests/integration/`
- `tests/P1/`
- `tests/P3/`
- `tests/P4/`
- `tests/fixtures/`
- `package.json` 当时副本
- `tsconfig.json` 当时副本

**已显式排除**：

- `node_modules/`
- `dist/`
- `.dteam/`（运行时数据）
- 主仓库的 `.doc/`（保留为设计目标档）

## 什么时候回看

后续从第一性原理重构时，可以回看：

- 旧 5 层分层的实际耦合度
- 旧 `WorkerConfig` / `ExecutionContext` 的过度抽象
- 旧 `SignalBus` / `SignalLog` 的双层设计是否符合最小闭环
- 旧 `chainPlanner` 为什么从单层 checklist 演变成双层
- 旧 `worker-widget` 的渲染层职责是否合理

## 重构目标

保留：

- task 双层验收模型
- workItems 作为运行态真相
- 结构化信号协议
- 半自动 + 人工确认
- 文档化的设计协议

抛弃：

- 过度分层（P0-P4 5 层但很多是占位）
- 过度抽象（WorkerConfig + options 数组 + normalize 三件套）
- 协议层强、运行态弱的脱节

## 关联文档

- `/.doc/研究/ant-colony-vs-dteam-最终对比.md`
- `/Users/diwu/Documents/codes/Githubs/pi-dteam/.dteam/task/从零重写-dteam-worker-引擎主干-20260603222236-kp82.md`
