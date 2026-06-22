# UI 模块

> 负责 dteam 0.6.0 的运行态展示：compact widget（紧凑小组件）、`/dteam` 展开面板、UI 状态存储。

## 文件职责

| 文件 | 职责 |
|---|---|
| `store.ts` | `UIStore` 单例：0.6.0 最小 worker 状态快照（`goal` + `workers` + `signals` + 完成态）。已去掉 0.5.0 的 mode/scheduling/strategies |
| `panel.ts` | 渲染 compact widget 与 `/dteam` 面板命令；处理 `/dteam 0~4` 切 tab 与 `/dteam close` |
| `index.ts` | 统一导出 UI 能力（`renderWidget` / `renderWidgetIfChanged` / `handlePanelCommand` / `isPanelExpanded` / `clearWidget`） |

## 展示原则

- compact widget 只显示低噪声摘要：标题、状态、running worker 的单行摘要。
- widget 只在状态内容变化时重新 `setWidget`，不为了 duration 秒表强制刷新，避免在部分 TUI 场景里刷屏。
- done worker 不显示输出，避免完成态噪音堆积。
- Markdown 标题、列表、代码围栏和长分隔线不进入 compact widget。

## 0.6.0 口径修正

- ❌ 不再说 `mode` / `scheduling` / `team` / `solo` / `chain` / `batches` / `conflicts`——这些是 0.5.0 二维编排字段，0.6.0 已删除（ADR 0005）。
- ❌ `helpers.ts` 已删除，不再列入文件职责。
- ❌ 不再说"ui-panel.test.ts / ui-store.test.ts"——这两个测试不存在。

## 0.6.0 用户感知粒度

用户对一次 dteam 的感知是三段：**开启 dteam → 完成工作 → 验收工作（check 收口）**。worker 内部的工具调用轮次、逐轮推理细节属于黑箱，不进 UI（见 `doc/术语表.md` 的 `Live Loop View`）。

详见 ADR 0005（召唤池重定义）。