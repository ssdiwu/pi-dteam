# v1 最小闭环设计

> v1 的设计逻辑——**为什么 4 个文件就够了**。

## 核心断言

> **dteam v1 真正独有的"立身之本"不是 AC 层、不是信号系统、不是面板。**
>
> **是——用 LLM 结构化输出（tool calling）+ 任务池的递归循环，替代 ant-colony 的"自由文本 parser + 任务池循环"。**

## ant-colony 是什么样子

ant-colony 12 个文件跑通：

```text
Queen (queen.ts)
  ├─ Nest (nest.ts)：任务池 + 文件锁 + 信息素
  ├─ Spawner (spawner.ts)：调 LLM 跑任务
  ├─ Parser (parser.ts)：200 行解析 LLM 自由输出
  ├─ Concurrency：自适应并发
  └─ Deps：import 依赖图
```

主循环（简化）：

```text
while (有 pending 任务):
  task = nest.claimNextTask(caste, "queen")
  result = spawnAnt(task)  // 调 LLM
  nest.updateTaskStatus(task.id, "done")
  for sub in parseSubTasks(result.output):  // 200 行 parser
    nest.addSubTask(parent, sub)  // 子任务回池
```

**核心创新是：自由文本 → parser → 子任务回池**。

## dteam v1 做了什么

只改 1 处：**把 parser 换成 LLM tool calling**。

```text
while (有 pending 任务):
  task = pool.claimNext()
  decision = await brancher.decide(task)  // LLM 调 decide 工具，返回结构化 { kind, subTasks }
  if decision.kind == "decompose":
    for sub in decision.subTasks:
      pool.write(sub)
  else:
    result = await leaf.execute(task)  // LLM 干活
  pool.update(task.id, "done")
```

**LLM 直接返回结构化 SubTask 数组**——不需要 200 行 parser。

## 4 个文件

| 文件 | 角色 | 一句话 |
|------|------|--------|
| `pool.ts` | 任务池 | write / claimNext / update |
| `brancher.ts` | 分支器 | 问 LLM：要做还是要拆 |
| `leaf.ts` | 叶子 | 调 LLM 实际干活 |
| `orchestrator.ts` | 编排器 | 驱动主循环 |

**总代码量 ~ 600 行**（含类型和注释）。

## v1 明确不做的事

| 不做 | 原因 |
|------|------|
| 文件持久化 | 跑完即丢，v1 不落盘 |
| 文件锁 / 原子操作 | v1 同步阻塞，JS 单线程保证 |
| 自适应并发 | v1 顺序跑，够用 |
| 进度面板 | 用 `ctx.ui.setStatus` 简单提示 |
| 信号流 | 不做 |
| 双层验收 (A/B) | v2 再说 |
| help / resume | v2 再说 |
| Parser | LLM tool calling 替代 |

## v1 跑通的标准

1. `npm run build` 通过
2. `pi -e ./extensions/index.ts` 能加载
3. 调 `dteam(action="run", goal="...")` 能返回 `RunResult`
4. 主对话里能看到任务树展开

## v1 → v2 路线（不写代码，先记着）

| v2 加什么 | 解决什么 |
|----------|----------|
| 让 leaf 真的能改文件 | v1 leaf 只是"说会改"，没真改 |
| 任务池文件持久化 | 崩溃能续跑 |
| A/B 双层验收 | 区分"机器能验"vs"需要人判断" |
| help / resume | 失败后能补救一次 |
| 自适应并发 | 多任务并行 |
| 进度面板 | 看 worker 树展开 |

每个 v2 改动都要**先回到第一性原理重新审视**，不要直接堆代码。
