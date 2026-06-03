# AGENTS.md

> 写给接手 dteam v1 的 AI 助手和 507 自己的笔记。

## 一句话

dteam v1 是一个 Pi 扩展，把"派一个 worker"做成一棵递归的 worker 树，**4 个核心文件**就够。

**先读 [`src/README.md`](./src/README.md) 再动手。**

## 项目结构速查

| 路径 | 用途 | 重要性 |
|------|------|--------|
| `src/README.md` | v1 定义文档 | **必读** |
| `src/tools.ts` | 工具表（Pi 提供的 / dteam 暴露的 / 内部 helper） | **必读** |
| `src/orchestrator.ts` | 主循环 | 必读 |
| `src/brancher.ts` | 问 LLM：拆还是干 | 必读 |
| `src/leaf.ts` | 调 LLM 干活 | 必读 |
| `src/pool.ts` | 任务池（内存） | 必读 |
| `src/index.ts` | Pi 扩展入口 | 必读 |
| `doc/design.md` | v1 最小闭环设计 | 参考 |
| `doc/vs-ant-colony.md` | 与 ant-colony 对比 | 参考 |
| `archive/v0-pre-rewrite/` | v0 完整归档 | **不要回去抄** |
| `.doc/` | v0 文档（已归档） | **不要参考** |

## 开发规范

### 做
- ✅ 先读 `src/README.md` 和 `src/tools.ts`
- ✅ 改完后跑 `npm run build` 验证
- ✅ 改完后跑 `pi -e ./extensions/index.ts` 试加载
- ✅ 保持文件数 ≤ 6（v1 范围）
- ✅ 用 LLM 的 tool calling 做结构化输出，**不要解析自由文本**

### 不做
- ❌ 不要回去抄 `archive/v0-pre-rewrite/` 里的代码
- ❌ 不要回去参考 `.doc/` 里的 v0 设计（除了 v0 归档说明）
- ❌ 不要加文件锁、原子操作、并发控制、面板、持久化
- ❌ 不要做自适应并发（v2 再说）
- ❌ 不要做双层验收 / help / resume（v2 再说）
- ❌ 不要重新发明 parser（用 LLM tool calling 替代）

## 验证流程

改完后**必须**跑：

```bash
# 1. 编译
npm run build

# 2. 在 Pi 里重载
# 按 /reload

# 3. 实际调 dteam 工具
# 让主 LLM 调 dteam(action="run", goal="简单任务")
```

**如果 build 失败，必须先修。**  
**如果 build 过但 dteam 调不通，贴错误信息。**

## 改动的边界

| 想加什么 | 怎么办 |
|----------|--------|
| 改 LLM 调用的方式 | 改 `brancher.ts` 或 `leaf.ts` |
| 改任务池行为 | 改 `pool.ts` |
| 改主循环逻辑 | 改 `orchestrator.ts` |
| 改对外暴露的 dteam 工具 | 改 `src/index.ts` |
| 加新工具 | **不推荐**——dteam v1 故意只暴露 1 个工具 |
| 加面板 / 持久化 / 并发 | **v2 再做**，v1 不动 |
| 重构 | 看完 `doc/design.md` 确认你理解 v1 设计 |

## 状态机提醒

WorkItem 状态（`pool.ts`）：

```
pending → in_progress → done
                     → failed
```

v1 不做：waiting_help / blocked / skipped 状态。这些是 v0 设计的，**v1 不实现**。

## 提交规范

每次 `Git commit`（Git 提交）只做一件事。

示例：
- `feat(v1.1): 让 leaf 实际能改文件`
- `fix(v1): 修正 brancher 解析 tool call 的逻辑`
- `docs(v1): 更新 doc/design.md`

**提交前**：
- `npm run build` 通过
- 改动的文件数 ≤ 5

## 联系 / 上下文

- 这个项目是 507（diwu）的
- 设计参考：ant-colony（`/Users/diwu/.pi/agent/extensions-backup/ant-colony.disabled/`）
- v0 完整归档：`archive/v0-pre-rewrite/README-archive.md`
- v1 决策记录：见 git log + `doc/`
