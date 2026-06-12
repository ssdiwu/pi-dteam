# AGENTS.md

> 写给接手 dteam 的 AI 助手和 507 自己的笔记。

## 一句话

dteam 是 **Pi 里的多 subagent 协作引擎**——简单任务主 LLM 直接干，复杂任务派多 worker 协作（**后台运行不阻塞主对话**）。代码组织见 `src/README.md`。

**先读 [`src/README.md`](./src/README.md) 再动手。**

## 项目结构速查

| 路径 | 用途 | 重要性 |
|------|------|--------|
| `src/README.md` | 当前定义文档 | **必读** |
| `src/tools.ts` | 工具表（Pi 提供的 / dteam 暴露的 / 内部 helper） | **必读** |
| `src/orchestrator.ts` | 主循环 | 必读 |
| `src/planner.ts` | 规划器（规则判断 + LLM 兜底） | 必读 |
| `src/leaf.ts` | 调 LLM 干活 | 必读 |
| `src/pool.ts` | 任务池（内存） | 必读 |
| `./index.ts` | Pi 扩展入口（根目录） | **必读** |
| `归档/v1-设计/` | 历史设计稿 | 仅参考，**不要照搬** |
| `archive/v0-pre-rewrite/` | v0-pre-rewrite 完整归档 | **不要回去抄** |

## 开发规范

### 做
- ✅ 先读 `src/README.md` 和 `src/tools.ts`
- ✅ 改完后跑 `npm run build` 验证
- ✅ 改完后跑 `pi -e ./extensions/index.ts` 试加载
- ✅ 保持文件数合理（按职责拆，不强求数量）
- ✅ 用 LLM 的 tool calling 做结构化输出，**不要解析自由文本**

### 不做
- ❌ 不要回去抄 `archive/v0-pre-rewrite/` 里的代码
- ❌ 不要回去参考历史归档里的 v0 设计（除了 v0 归档说明）
- ❌ 不要加文件锁、原子操作
- ❌ 不要做自适应并发（动态调 batchSize 会让结果不可预测）
- ❌ 不要做双层验收（一次 check 够了）
- ❌ 不要做 resume（未规划；要做先单独写方案）
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
| 改 LLM 调用的方式 | 改 `planner.ts` / `leaf.ts` / `session.ts` |
| 改任务池行为 | 改 `pool.ts` |
| 改主循环逻辑 | 改 `orchestrator.ts` |
| 改对外暴露的 dteam 工具 | 改 `./index.ts` |
| 加新工具 | **不推荐**——dteam 故意只暴露 1 个工具 |
| 加面板 / 持久化 / 并发 | 现状已有（`src/ui/` / `src/signals/`），按需改 |
| 重构 | 看完 `归档/v1-设计/设计-v1.md` 确认你理解 dteam 的设计脉络 |

## 状态机提醒

WorkItem 状态（`pool.ts`）：

```
pending → in_progress → done
                     → failed
```

实际信号（`src/signals/`）有 help / found / progress / blocked —— 状态机没显式列这些，靠 `SignalBus` 事件流表达。
历史状态机（waiting_help / blocked / skipped）在 `归档/v1-设计/`，**不要照搬**。

## 提交规范

每次 `Git commit`（Git 提交）只做一件事。

示例：
- `feat: 让 leaf 实际能改文件`
- `fix: 修正 planner 结构化输出解析逻辑`
- `docs: 更新 doc/设计-v2.md`

**提交前**：
- `npm run build` 通过
- 改动的文件数 ≤ 5

## 联系 / 上下文

- 这个项目是 507（diwu）的
- 当前版本：见 `package.json` 的 `version` 字段
- 设计参考：ant-colony（`/Users/diwu/.pi/agent/extensions-backup/ant-colony.disabled/`）
- 历史归档：`archive/v0-pre-rewrite/README-archive.md`（v0-pre-rewrite 时期）
- 决策记录：见 git log + `doc/`
