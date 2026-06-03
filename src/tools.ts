/**
 * dteam v1 — 工具表
 *
 * 这是 dteam v1 的接口契约文档。
 *
 * 包含三类：
 * - A. Pi 提供的工具（我们用，但不改）
 * - B. dteam 暴露给 LLM 的工具（我们写）
 * - C. dteam 内部 helper（不暴露给 LLM）
 *
 * 写在这里的目的：
 * - 后期 507 接手能一眼看懂边界
 * - 接手 AI 能照表写扩展
 * - 我们回看时不用再翻 SDK 文档
 */

// ═══ A. Pi 提供的工具（我们用，但不改） ═══

/**
 * A-1. `createAgentSession` — 启一个 LLM 会话
 *
 * 来源：@earendil-works/pi-coding-agent
 * 用途：brancher / leaf 调 LLM 的入口
 * 被谁调：brancher.ts / leaf.ts
 * 是否阻塞：是（v1 同步阻塞模式）
 * 失败策略：v1 直接抛错，由 orchestrator 捕获后记录在 task.result
 */

/**
 * A-2. `session.prompt(task)` — 推 prompt 拿结果
 *
 * 来源：session 实例方法
 * 用途：发 prompt 给 LLM，等结果
 * 被谁调：brancher.decide / leaf.execute
 * 是否阻塞：是
 * 失败策略：抛错由 caller 处理
 */

/**
 * A-3. `ExtensionAPI.registerTool` — 注册 LLM 可调的工具
 *
 * 来源：pi: ExtensionAPI
 * 用途：把 dteam 这个工具暴露给主 LLM
 * 被谁调：index.ts
 * 失败策略：注册失败抛错
 */

/**
 * A-4. `ExtensionContext.ui.notify` / `setStatus`
 *
 * 来源：ctx.ui
 * 用途：顶部通知 / 底部状态栏
 * 被谁调：orchestrator 在循环里调
 * v1 用法：notify 显示 "dteam running..." 一次；setStatus 显示 "dteam: working" 实时
 */

/**
 * A-5. `Type.Object` / `Type.Array` / `Type.String`（typebox）
 *
 * 来源：typebox
 * 用途：工具参数 schema
 * 被谁调：tools.ts / index.ts
 */

// ═══ B. dteam 暴露给 LLM 的工具（我们写） ═══

/**
 * B-1. `dteam` — 唯一对外工具
 *
 * 行为：同步阻塞跑完一个 goal 才返回
 *
 * 参数：
 *   - action: "run"  唯一 action（v1 暂时只支持 run）
 *   - goal: 用户目标（自由文本）
 *
 * 返回：
 *   - status: "done" | "failed"
 *   - plan: 实际执行的 plan（任务树展开）
 *   - workItems: 所有 task 的快照
 *   - summary: 一句话总结
 *
 * LLM 怎么调：
 *   - 调一次 dteam(action="run", goal="...") → 等结果
 *   - 拿到结果后告诉用户
 */

// ═══ C. dteam 内部 helper（不暴露给 LLM） ═══

/**
 * C-1. `dispatch(task)` — orchestrator 的单步
 *
 * 文件：orchestrator.ts
 * 签名：async (task: Task) => Promise<void>
 * 行为：claim 一个 task → 问 brancher 要不要拆 → 拆 or 干
 */

/**
 * C-2. `run(goal)` — orchestrator 的入口
 *
 * 文件：orchestrator.ts
 * 签名：async (goal: string) => Promise<Result>
 * 行为：写根任务 → 循环 dispatch → 收尾
 */

/**
 * C-3. `decide(task)` — brancher 的核心
 *
 * 文件：brancher.ts
 * 签名：async (task: Task) => Promise<Decision>
 * 行为：调 LLM 问 "要拆还是干"，返回结构化 Decision
 */

/**
 * C-4. `execute(task)` — leaf 的核心
 *
 * 文件：leaf.ts
 * 签名：async (task: Task) => Promise<string>
 * 行为：调 LLM 实际干活，返回结果文本
 */

/**
 * C-5. `write(task)` / `claimNext()` / `update()` — pool 的操作
 *
 * 文件：pool.ts
 * 用途：内存 task 池
 * v1 简化：无锁、无持久化、无并发控制
 */

// ═══ 类型定义（TypeScript 实际使用的） ═══

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

/**
 * 一个可被 dteam 处理的最小任务单元
 */
export interface Task {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  result?: string;
  createdAt: number;
}

/**
 * brancher 的决策：拆还是干
 */
export type Decision =
  | { kind: "execute"; reason: string }
  | { kind: "decompose"; reason: string; subTasks: Array<{ title: string; description: string }> };

/**
 * orchestrator 的总返回
 */
export interface RunResult {
  status: "done" | "failed";
  workItems: Task[];
  summary: string;
}
