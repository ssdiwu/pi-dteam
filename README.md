# dteam

> **半自动多角色编排引擎**，作为 Pi 扩展运行。
>
> v1 状态：核心功能落地 + 189 个测试通过，UI + 角色系统可用。

## 一句话

dteam 把"派一个 worker 干一件事"做成一棵二维编排的 worker 树——**组织形式**（solo / chain / team）× **执行策略**（direct / build_check / adaptive），每个 step 选 5 个角色之一（explore / design / build / check / close）执行。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 运行测试（189 个用例）
npm test

# 4. 安装到 Pi
pi install "$(pwd)"

# 5. 在 Pi 里按 /reload 重载

# 6. 调 dteam 工具
# 让主 LLM 调 dteam(action="run", goal="你的目标")

# 7. /dteam 命令
# 在 Pi 里输 /dteam 打开进度面板
```

## 用法

### 通过主 LLM 调用

dteam 暴露 1 个工具：

```typescript
dteam(action="run", goal="在 /tmp 下创建 hello.txt")
```

返回 `RunResult`：

```json
{
  "status": "done",
  "goal": "...",
  "plan": { "mode": "chain", "steps": [...] },
  "steps": [...],
  "summary": "5/5 完成"
}
```

### 通过 `/dteam` 命令

在 Pi 里输入 `/dteam`：
- 第一次：打开面板（有 run 显示进度，无 run 显示空态）
- 第二次：关闭面板

## 文档

- [架构说明（二维编排模型）](./docs/architecture.md)
- [角色系统（5 个角色职责）](./docs/roles.md)
- [工具 API](./docs/api.md)
- [src/ 内部架构](./src/README.md)
- [设计文档总览](./doc/README.md)
- [v1 vs ant-colony 差距](./doc/gap-analysis.md)
- [v2 设计稿（二维编排）](./doc/design-v2.md)

## 目录结构

```
.
├── index.ts                # Pi 扩展入口
├── src/
│   ├── orchestrator.ts     # 三阶段：plan → execute → report
│   ├── planner.ts          # Phase 1: 规则判断 + LLM 兜底
│   ├── leaf.ts             # Phase 2: 用角色调 LLM 执行
│   ├── brancher.ts         # 旧递归分解（保留备用）
│   ├── pool.ts             # 任务池
│   ├── session.ts          # createWorkerSession 工厂 + 角色系统
│   ├── tools.ts            # 类型定义
│   ├── ui-store.ts         # UI 全局状态
│   ├── ui-panel.ts         # /dteam 面板
│   ├── ui-render.ts        # 渲染工具函数
│   └── ui-widget.ts        # 折叠态 widget
├── agents/                 # 5 个角色定义
│   ├── explore.md
│   ├── design.md
│   ├── build.md
│   ├── check.md
│   └── close.md
├── tests/                  # 189 个测试
├── doc/                    # 设计文档
├── docs/                   # 用户文档
├── archive/                # v0 历史归档
└── ...
```

## 设计哲学

- **半自动**：人通过 Pi 主对话用 dteam，dteam 不替你拍板
- **二维编排**：组织形式（solo/chain/team）× 执行策略（direct/build_check/adaptive），9 种组合
- **角色系统**：5 个角色分工，build 唯一能改代码
- **规则优先**：planner 用规则判断（零 LLM 成本），复杂情况才调 LLM
- **同步阻塞**：dteam 工具调用不返回直到跑完
- **MiniMax-M3 优先**：主模型找不到自动降级到 M2.7

## 验证状态

- ✅ v1 核心代码落地（11 个 TS 文件）
- ✅ `npm run build` 通过
- ✅ 189/189 单元测试通过
- ✅ 4 个真实任务实测通过（solo/chain/team/adaptive 全部命中）
- ⏳ UI 面板验证（需 /reload 后实测）
- ⏳ v1.1：自适应并发、信息素、持久化（v2+）

## 相关链接

- v0 历史归档：[`archive/v0-pre-rewrite/`](./archive/v0-pre-rewrite/README-archive.md)
- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md>
