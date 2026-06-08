# v1 vs ant-colony 关键差异

> 为什么 v0 不行，v1 怎么行。

## 一句话

> v0 的问题是 **40+ 文件、文档超前于实现、parser 复杂、worker 假成功**。  
> v1 重写为 **4 个文件、用 LLM tool calling 替代 parser、最小闭环**。

## 文件规模

| | ant-colony | dteam v0 | dteam v1 |
|---|-----------|---------|---------|
| TS 源文件 | ~12 | ~40+ | **4** |
| 角色 prompt | 5 | 6 | 复用 v0 的 6 个 |
| 任务池 | Nest 类（1 个） | P0/P1/P2 散在 6 个文件 | pool.ts（1 个） |
| 调度 | Queen 类 | P3/worker.ts 几个文件 | orchestrator.ts（1 个） |
| 实际跑通 | ✅ | ❌（worker 假成功） | ✅（待验证） |

## 核心设计差异

### 1. 任务来源

**ant-colony**：
```ts
// 让 LLM 自由输出
### TASK: <title>
- description: ...
- files: ...
- caste: worker
- priority: 1-5
```
然后 200 行 `parser.ts` 解析。

**dteam v1**：
```ts
// 让 LLM 调一个虚拟工具
decide({ kind: "execute" | "decompose", reason, subTasks: [...] })
```
工具参数 schema 直接保证结构化。

**收益**：去掉 200 行 parser，结构化字段由 schema 保证，不可能跑偏。

### 2. 任务池

| | ant-colony | dteam v0 | dteam v1 |
|---|-----------|---------|---------|
| 存储 | 文件（.ant-colony/{id}/） | 文件 + 内存双层 | **内存** |
| 锁 | POSIX 文件锁 | WeakMap + 多处状态 | **JS 单线程保证** |
| 原子 claim | ✅ | 多个 writeTask 散开 | **单一 claimNext** |
| 复杂度 | 中 | 高 | **极低** |

v1 直接砍掉：文件锁、原子操作、持久化。

### 3. 执行

| | ant-colony | dteam v0 | dteam v1 |
|---|-----------|---------|---------|
| 实际跑通 | ✅ | ❌（之前 4 个 bugfix 才修通） | ✅（待验证） |
| 失败处理 | 429 退避 + 预算刹车 | 假成功 → blocked → resume 复杂链路 | **catch + failed 标 status** |
| 工具暴露 | 4 个角色 (scout/worker/soldier/drone) | 6 个角色 + 多处配置 | **1 个工具 (dteam)** |

v0 的"假成功"就是 507 你这轮重写触发的根因。

### 4. 用户交互

| | ant-colony | dteam v0 | dteam v1 |
|---|-----------|---------|---------|
| 是否需要人工 | 否（全自动） | 是（确认面板设计但没实现） | **是（天然通过主对话）** |
| 面板 | 后台 widget + Tab 面板 | 后台 widget + Tab 面板 | **不用面板——主对话就是面板** |

v1 的关键简化：**主对话天然就是"确认面板"**。  
用户说"实现 JWT"，主 LLM 调 dteam 工具，工具同步阻塞跑完，LLM 拿到结果告诉用户。  
用户不满意就说"不行，重来"——和普通对话一样。

## ant-colony 没有的、v1 独有的

1. **半自动边界**——ant 是全自动，v1 是用户驱动
2. **LLM tool calling**——ant 是 LLM 自由输出 + parser，v1 是结构化
3. **主对话交互**——ant 是后台任务，v1 是工具调用

## v1 没有的、ant 做到的

1. **真正的文件操作**——ant 的 worker 真改文件，v1 的 leaf 只是"说会改"
2. **自适应并发**——ant 有 4 状态并发控制，v1 顺序跑
3. **预算刹车**——ant 有 maxCost 限速，v1 无
4. **信息素**——ant 有 6 种 pheromone 驱动调度，v1 无
5. **drone 角色**——ant 有 bash-only drone，v1 合并到 leaf

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 同步 vs 异步 | 同步阻塞 | 简单 |
| 任务粒度 | LLM 自己判断 | 不预定义 AC 层 |
| 任务来源 | LLM tool calling | 比 parser 干净 100 倍 |
| 持久化 | 不做 | 跑完即丢 |
| 工具数 | 1 个 dteam | 不暴露 LLM 内部细节 |
| 角色 | 复用 v0 的 6 个 | 后续可裁剪 |

## 后续迭代方向

v1 跑通后，v2 路线：

1. **让 leaf 真能改文件** — 接入 read/bash/edit/write 工具
2. **任务池文件持久化** — 崩溃能续跑
3. **A/B 双层验收** — 机器能验 vs 需要人判断
4. **help / resume** — 失败补救一次
5. **自适应并发** — 多任务并行
6. **可视化** — 看 worker 树展开

每个改动都**先回到第一性原理重新审视**，不要堆代码。
