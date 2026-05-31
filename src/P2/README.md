# P2 — 细胞层

> 依赖 P0 + P1，提供编排模式和上下文构建。

## 模块清单

| 文件 | 职责 |
|------|------|
| `solo.ts` | Solo 模式：单角色执行，最小编排单元 |
| `chain.ts` | Chain 模式：顺序执行多个 step，前一步失败则停止 |
| `team.ts` | Team 模式：并行执行多个 worker，支持并发控制和超时 |
| `contextBuilder.ts` | 上下文构建器：构建 task/project/execution 三维执行上下文 |
| `authModule.ts` | 认证模块：封装 AuthService 为高层接口 |

## 依赖关系

```
P2 → P1 → P0
```

## 执行模式

```
solo:  role → executor → result
chain: step1 → step2 → ... → stepN（顺序）
team:  worker1 ‖ worker2 ‖ ... ‖ workerN（并行）
```

## 上下文构建流程

ContextBuilder.build() 做三件事：
1. **buildTaskContext** — 从 `.dteam/task/*.md` 解析任务元数据和阶段记录
2. **buildProjectContext** — 扫描目录结构、package.json、相关文件
3. **buildExecutionHistory** — 从共享内存读取历史执行结果

最终拼成 `ExecutionContext` 传给 executor。
