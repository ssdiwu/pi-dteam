# scheduler

0.5.0 引入的轻量调度层。

职责：

- `file-graph.ts`：基于 `PlanStep.files` 做轻量 import / require 文本扫描，生成 `FileGraph`。
- `preflight.ts`：后续阶段实现 conflict 分类与 batch 调度。
- `shared-files.ts`：后续阶段集中 shared file patterns。
- `index.ts`：统一导出 scheduler 能力。

边界：

- 只做 deterministic runtime（确定性运行时）逻辑，不调用 LLM。
- 不引入 TypeScript compiler API、Babel AST 或项目级索引。
- 缺文件、无法解析、扫描超限时降级为 `unresolved` / `unknown` / `truncated`，不阻塞执行。
