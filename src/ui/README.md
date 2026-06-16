# UI 模块

> 负责 dteam 的运行态展示：compact widget（紧凑小组件）、`/dteam` 展开面板、UI 状态存储和状态符号。

## 文件职责

| 文件 | 职责 |
|---|---|
| `store.ts` | `UIStore` 单例，保存当前 run 的 goal、mode、workers、signals、scheduling 和完成态快照 |
| `panel.ts` | 渲染 compact widget 与 `/dteam` 内容型 tabs；处理 `/dteam 0~4` 与 `/dteam close` |
| `helpers.ts` | 状态图标、颜色、signal 文案、duration 格式化 |
| `index.ts` | 统一导出 UI 能力 |

## 展示原则

- compact widget 只显示低噪声摘要：标题、状态、running worker 的单行摘要。
- widget 只在状态内容变化时重新 `setWidget`，不为了 duration 秒表强制刷新，避免在部分 TUI 场景里刷屏。
- done worker 不显示输出，避免完成态噪音堆积。
- Markdown 标题、列表、代码围栏和长分隔线不进入 compact widget。
- `delayed` 在 compact widget 中只用于 `team` 模式；`solo` / `chain` 的 scheduling 只作为解释信息，不当作运行阻塞展示。
- `/dteam` 展开面板可以展示更完整的信息，包括 batches、conflicts、files、signals 和 report。

## 验证

相关测试在 `tests/ui-panel.test.ts` 和 `tests/ui-store.test.ts`。
