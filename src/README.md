# dteam v1 — 定义

> 这是 dteam v1 的**定义文档**。先读这一篇，再读代码。

## 一句话定义

> **dteam v1 是一个 Pi 扩展，把"派一个 worker"做成一棵递归的 worker 树，每个节点问 LLM "我做还是拆"，做就自己干，拆就派子节点，直到全做完。**

---

## 设计哲学（已定）

- **半自动**：人通过 Pi 主对话用 507 你，dteam 不替你决策
- **单层工具暴露**：对 LLM 暴露 1 个 `dteam` 工具，同步阻塞跑完
- **递归分解**：B 模式，每层都问 LLM "要拆吗"
- **无 parser**：用 LLM 的 tool calling 做结构化输出，不解析自由文本
- **极简**：v1 不做持久化、不做文件锁、不做并发控制、不做面板

---

## 与 ant-colony 的核心差异

| 维度 | ant-colony | dteam v1 |
|------|------------|----------|
| 任务来源 | LLM 自由文本 + 200 行 parser | LLM **tool calling**（结构化） |
| 递归机制 | parser 抽 `### TASK:` 块 | LLM **直接返回 SubTask 数组** |
| 任务池 | file-based nest | 内存 pool（v1） |
| 调度循环 | Queen 自适应并发 | orchestrator 顺序循环（v1） |
| 执行 | spawnAnt + runDrone | leaf.execute |
| 状态文件 | `.ant-colony/{id}/` | 内存（v1 不落盘） |
| 状态机 | 5 步生命周期 | 1 个 while 循环 |

**dteam v1 不是"更复杂的 ant"，而是"用 LLM 工具调用替代 parser"的更干净版本**。

---

## v1 的最小闭环

```text
用户说"实现 X"
    ↓
主 LLM 调工具：dteam(action="run", goal="实现 X")
    ↓
dteam 内部：
    1. 写根 task 到 pool
    2. loop:
       a. claimNext() 拿一个 pending task
       b. 没有 → break
       c. 调 brancher.decide(task)
          → LLM 调 decide 工具，返回 { kind: "execute" | "decompose" }
       d. 拆：写子 task；当前 task 标 done
       e. 干：调 leaf.execute(task)；当前 task 标 done
    3. 返回 summary
    ↓
主 LLM 拿到结果，告诉用户
```

**整段对话是一个 tool call + 一段结果**。

---

## 4 个核心文件 + 1 个工具表 + 1 个桥接

```
src/
  README.md          ← 你正在读
  tools.ts           ← 工具表：Pi 提供的 / dteam 暴露的 / 内部 helper
  pool.ts            ← 任务池（内存，无锁，无持久化）
  brancher.ts        ← 问 LLM：要拆还是干
  leaf.ts            ← 调 LLM 实际干活
  orchestrator.ts    ← 主循环
  index.ts           ← Pi 扩展入口：注册 dteam 工具
  pi-bridge.ts       ← Pi session 状态同步（当前模型）
```

---

## 核心抽象

### Task

```ts
interface Task {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: string;
  createdAt: number;
}
```

### Decision（brancher 的输出）

```ts
type Decision =
  | { kind: "execute"; reason: string }
  | { kind: "decompose"; reason: string; subTasks: Array<{ title: string; description: string }> };
```

### RunResult（orchestrator 的总返回）

```ts
interface RunResult {
  status: "done" | "failed";
  workItems: Task[];
  summary: string;
}
```

---

## v1 明确不做的事

- ❌ 文件持久化
- ❌ 文件锁 / 原子操作
- ❌ 自适应并发
- ❌ 进度面板
- ❌ 持久信号流
- ❌ 双层验收（A / B 层）
- ❌ 帮助/续跑协议
- ❌ Parser / 自由文本解析

**这些都是 v0 设计过的，v1 不做**。  
v1 跑通最小闭环后再迭代。

---

## v1 跑通的标准

1. `npm run build` 通过
2. `npm test` 通过（v1 测试可加可不加）
3. `pi -e ./extensions/index.ts` 能加载
4. 调 dteam 工具：传一个 goal，能返回 `RunResult`

---

## 关键设计决策（已被 507 拍板）

| 决策 | 选择 | 理由 |
|------|------|------|
| 同步 vs 异步 | **同步阻塞** | 简单，5 分钟内可接受 |
| 并发 | **顺序**（v1） | 复杂自适应并发后续 |
| 任务粒度 | LLM 自己决定（"要拆吗"） | 不预定义 AC 层 |
| 任务来源 | LLM tool calling | 比 parser 干净 100 倍 |
| 持久化 | 内存（v1） | 不落盘，跑完即丢 |
| 双层验收 | 不做 | v0 留的设计债务，v1 不背 |

---

## 关联文档

- `tools.ts` — 工具表
- `archive/v0-pre-rewrite/` — v0 的完整归档（参考）
- `/.doc/P0-原子层/workItem.md` — v0 的 workItem 设计（不直接用于 v1）
- `/.doc/P0-原子层/task.md` — v0 的 task 双层验收（v1 不实现）
