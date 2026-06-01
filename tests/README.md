# tests

> dteam 测试目录。

## 目录结构

| 路径 | 职责 |
|------|------|
| `unit/` | P0/P1/P2 等模块级单元测试 |
| `P1/` | P1 服务层专项测试，包含 `spawn.ts` 的 Pi SDK mock 测试 |
| `P4/` | TUI/widget 相关测试，含 dteamTool 调度入口测试 |
| `integration/` | 跨模块集成测试 |

## 运行方式

```bash
npm test
```

`signalLog` 的跨进程测试会从 `dist/` 加载编译产物，因此完整验证前应先运行：

```bash
npm run build
```
