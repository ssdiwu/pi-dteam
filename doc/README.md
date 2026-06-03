# doc/ — v1 设计文档

v1 的设计依据与决策文档。

## 目录

| 文件 | 内容 |
|------|------|
| [`design.md`](./design.md) | v1 最小闭环设计：从 ant-colony 到 dteam v1 的核心思路 |
| [`vs-ant-colony.md`](./vs-ant-colony.md) | v1 与 ant-colony 的关键差异，为什么要重写 |

## 阅读顺序

1. 先看 [vs-ant-colony.md](./vs-ant-colony.md) — 了解"为什么 v0 不行"
2. 再看 [design.md](./design.md) — 了解"v1 怎么行"
3. 最后看 [`src/README.md`](../src/README.md) — 看代码结构

## 与其它文档的关系

- `src/README.md` — **v1 是什么**（代码视角）
- `doc/design.md` — **v1 为什么这样设计**（设计视角）
- `doc/vs-ant-colony.md` — **v0 vs v1 vs ant**（决策视角）
- `archive/v0-pre-rewrite/README-archive.md` — v0 完整快照
- `AGENTS.md` — 接手 AI 必读
