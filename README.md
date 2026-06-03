# dteam

> **半自动多 worker 编排引擎**，作为 Pi 扩展运行。
> 
> v1 状态：alpha，最小闭环已落地，正在验证。

## 一句话

dteam 暴露 1 个工具给主 LLM（`dteam`），把"派一个 worker"做成一棵递归的 worker 树——每个节点问 LLM "我做还是拆"，做就自己干，拆就派子节点，直到全做完。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 安装到 Pi
pi install .

# 4. 重载
# 在 Pi 里按 /reload

# 5. 调 dteam 工具
# 让主 LLM 调 dteam(action="run", goal="你的目标")
```

## 目录结构

```
.
├── src/                 # v1 源码（4 核心文件 + 工具表 + README）
│   ├── README.md        # ← 读这个看 v1 是什么
│   ├── tools.ts         # 工具表：Pi 提供的 / dteam 暴露的 / 内部 helper
│   ├── pool.ts          # 任务池
│   ├── brancher.ts      # 问 LLM：要拆还是干
│   ├── leaf.ts          # 调 LLM 干活
│   ├── orchestrator.ts  # 主循环
│   └── index.ts         # Pi 扩展入口
│
├── doc/                 # v1 设计文档
│   ├── README.md        # 文档入口
│   ├── design.md        # v1 最小闭环设计
│   └── vs-ant-colony.md # 与 ant-colony 的对比
│
├── archive/             # v0 历史快照（参考用）
│   └── v0-pre-rewrite/  # 完整归档
│
├── extensions/          # Pi 扩展入口文件
│   └── index.ts         # 重新指向 src/index.ts
│
├── package.json
├── tsconfig.json
└── README.md            # 你正在读
```

## v0 → v1 的变化

v0 是 40+ 个 TS 文件、5 层分层、文档超前实现的设计。

v1 重写为 4 个核心文件：

| 文件 | 角色 |
|------|------|
| `src/pool.ts` | 任务池（内存，无锁） |
| `src/brancher.ts` | 问 LLM：要拆还是干 |
| `src/leaf.ts` | 调 LLM 干活 |
| `src/orchestrator.ts` | 主循环 |

详细对比见 `doc/vs-ant-colony.md`。

## 设计哲学

- **半自动**：人通过 Pi 主对话用 dteam，dteam 不替你决策
- **单层工具暴露**：对 LLM 暴露 1 个 `dteam` 工具
- **递归分解**：B 模式，每层都问 LLM "要拆吗"
- **无 parser**：用 LLM 的 tool calling 做结构化输出
- **极简**：v1 不做持久化、不做文件锁、不做并发控制、不做面板

## 当前状态

- [x] v1 核心代码落地
- [x] `npm run build` 通过
- [ ] 实际跑通 dteam 工具调用（待验证）
- [ ] 接入真实文件操作工具（v1.1）
- [ ] 跑通后写测试（v1.2）

## 相关链接

- 设计文档：[`doc/`](./doc/README.md)
- v0 历史归档：[`archive/v0-pre-rewrite/`](./archive/v0-pre-rewrite/README-archive.md)
- Pi 扩展开发文档：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md>
