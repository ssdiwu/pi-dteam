/**
 * P0-原子层：workItem 数据模型
 *
 * dteam 运行态任务池的最小调度单元。
 * 它不取代 `task`，而是从 `task` 的双层验收条件 materialize 出来。
 *
 * 设计依据：
 * - /.doc/P0-原子层/workItem.md
 * - /.doc/P0-原子层/task.md
 * - /.doc/P3-组织层/workItem-v1-实现稿.md
 *
 * 约束：
 * - 纯类型 + 纯函数（不依赖任何上层）
 * - 不引入 fs / path / 进程副作用
 * - `extractAcceptanceModel` 是与 chainPlanner / contextBuilder 共用的 Markdown 解析器
 */

// ── 状态机 ────────────────────────────────────────────────────

/** workItem 状态机（详见 workItem.md） */
export type WorkItemStatus =
	| "todo" // 已存在但前置依赖未满足
	| "ready" // 可以被 Root claim
	| "in_progress" // 已分配给某个 worker
	| "waiting_help" // 已 help，逻辑冻结等待辅助
	| "blocked" // 停住，需 Root / 人工决策
	| "done" // 完成并有证据（终态）
	| "skipped"; // 明确跳过（终态）

/** 执行策略（与 worker 编排层二维模型一致） */
export type ExecutionStrategy = "direct" | "build_check" | "adaptive";

// ── 来源 ──────────────────────────────────────────────────────

/** 来自 task A 层 AC 的 source */
export interface AcceptanceSource {
	kind: "acceptance";
	taskPath: string;
	/** 例如 "AC-1" */
	acId: string;
	/** 原始 AC 文本（去除 acId 前缀） */
	acText: string;
}

/** 运行中由 Root 派生的 source（v1 仅结构保留） */
export interface DerivedSource {
	kind: "derived";
	taskPath: string;
	parentWorkItemId?: string;
	reason: string;
}

export type WorkItemSource = AcceptanceSource | DerivedSource;

// ── 记录 ──────────────────────────────────────────────────────

/** 单次 attempt 记录 */
export interface AttemptRecord {
	id: string;
	workerId: string;
	role?: string;
	status: "running" | "help_requested" | "blocked" | "done" | "cancelled";
	startedAt: string;
	endedAt?: string;
	summary?: string;
	blockedReason?: string;
}

/** 单次 helper 记录（help 派发后挂在原 workItem 下） */
export interface HelperRecord {
	id: string;
	fromAttemptId: string;
	helperRole: "explore" | "check" | "design" | "build";
	workerId?: string;
	status: "requested" | "running" | "done" | "failed";
	requestSummary: string;
	resultSummary?: string;
	helpPath?: string;
	resumePath?: string;
	createdAt: string;
	updatedAt: string;
}

// ── 计划 / 产出 ──────────────────────────────────────────────

/** Root 选定的执行计划 */
export interface SelectedPlan {
	orgForm: "solo" | "chain" | "team";
	strategy: ExecutionStrategy;
	reason?: string;
}

/** workItem 完成后的产出 */
export interface WorkItemOutputs {
	files?: string[];
	commands?: string[];
	summary?: string;
	evidence?: string[];
}

// ── WorkItem ──────────────────────────────────────────────────

/** 运行态任务池的最小调度单元 */
export interface WorkItem {
	/** 初始项默认复用 AC-1 / AC-2；动态派生项可用 WI-1 */
	id: string;
	source: WorkItemSource;
	/** 短标题（面板与调度器视图） */
	title: string;
	/** 最小仍保留的"为什么算完成"判据 */
	acceptance: string[];
	status: WorkItemStatus;
	/** v1 缺省为空（不从 Markdown 强行解析依赖） */
	dependsOn: string[];
	ownerWorkerId?: string;
	selectedPlan?: SelectedPlan;
	findings?: string[];
	attempts: AttemptRecord[];
	helpers: HelperRecord[];
	outputs?: WorkItemOutputs;
	createdAt: string;
	updatedAt: string;
}

// ── RunState ──────────────────────────────────────────────────

/** 一次 run 的状态根对象 */
export interface RunState {
	runId: string;
	taskId: string;
	goal: string;
	workItems: WorkItem[];
	/** B 层人工裁决项的原始文本（仅在 final review 时由用户确认） */
	humanReview?: string[];
	createdAt: string;
	updatedAt: string;
}

/** checklistStatus 投影：面板简视图（v1 不允许单独维护） */
export interface ChecklistStatus {
	id: string;
	text: string;
	status: WorkItemStatus;
	workerId?: string;
}

// ── 双层验收模型 ──────────────────────────────────────────────

/** A 层可校验项（结构化） */
export interface AcceptanceItem {
	/** 例如 "AC-1"（始终为规整后的 "AC-N" 形式） */
	acId: string;
	/** 原始 AC 文本（可能含人类描述，已去除 leading acId） */
	acText: string;
}

/** task 双层验收条件解析结果 */
export interface AcceptanceModel {
	/** A 层：可被 Root materialize 成 workItems[] */
	machine: AcceptanceItem[];
	/** B 层：人工裁决项，保留给最终 review */
	human: string[];
}

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 从一段文本里解析出 AC id（规整为 "AC-N" 形式）。
 *
 * 接受写法：
 * - `AC-1 描述`
 * - `AC_1 描述`
 * - `AC 1 描述`
 * - `**AC-1** 描述`  → 解析出 acId 即可
 *
 * @returns 规整后的 acId；没有匹配则返回 null
 */
export function parseAcId(raw: string): string | null {
	const m = raw.match(/\b(AC[-_ ]?\d+)\b/i);
	if (!m) return null;
	return m[1]
		.toUpperCase()
		.replace(/\s+/g, "-")
		.replace(/_/g, "-");
}

/**
 * 从 `## 验收条件` section 里抽取双层验收模型。
 *
 * 行为：
 * 1. 找 `## 验收条件[（...）]` 范围；找不到 → 返回空模型
 * 2. 若内部有 `### A. 可校验` / `### B. 人工裁决` 两个子 section，按 A/B 分类
 * 3. 若没有子 section（旧单层结构），整段 checklist 一律视作 A 层
 * 4. A 层只保留能解析出 acId 的项；B 层保留全部 checklist 原始文本
 *
 * @param content 完整 task Markdown 内容
 */
export function extractAcceptanceModel(content: string): AcceptanceModel {
	const sectionText = extractAcceptanceSection(content);
	if (!sectionText) return { machine: [], human: [] };

	const aMatch = sectionText.match(
		/###\s+A[.、:：]?\s*可校验[^\n]*\n([\s\S]*?)(?=\n###|\n##\s|$)/,
	);
	const bMatch = sectionText.match(
		/###\s+B[.、:：]?\s*人工裁决[^\n]*\n([\s\S]*?)(?=\n###|\n##\s|$)/,
	);

	const machine: AcceptanceItem[] = [];
	if (aMatch) {
		for (const raw of collectChecklistItems(aMatch[1])) {
			const acId = parseAcId(raw);
			if (!acId) continue;
			machine.push({ acId, acText: raw });
		}
	} else {
		// 兼容旧单层结构：所有 checklist 视作 A 层
		for (const raw of collectChecklistItems(sectionText)) {
			const acId = parseAcId(raw);
			if (!acId) continue;
			machine.push({ acId, acText: raw });
		}
	}

	const human: string[] = [];
	if (bMatch) {
		for (const raw of collectChecklistItems(bMatch[1])) {
			human.push(raw);
		}
	}

	return { machine, human };
}

// ── 内部 helpers ──────────────────────────────────────────────

/** 提取 `## 验收条件[（...）]` section 的正文（不含标题行） */
function extractAcceptanceSection(content: string): string | null {
	const headingRegex = /^##\s+(.+)$/gm;
	const targetRe = /^\s*验收条件/;
	let match: RegExpExecArray | null;
	let start: number | null = null;
	let end: number | null = null;

	while ((match = headingRegex.exec(content)) !== null) {
		const title = match[1].trim();
		if (start === null && targetRe.test(title)) {
			start = headingRegex.lastIndex;
		} else if (start !== null && end === null) {
			end = match.index;
			break;
		}
	}
	if (start === null) return null;
	if (end === null) end = content.length;
	return content.slice(start, end);
}

/** 抽取 `- [ ] ...` / `- [x] ...` 行 */
function collectChecklistItems(text: string): string[] {
	const items: string[] = [];
	const re = /- \[[ x]\]\s*(.+)$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		items.push(m[1].trim());
	}
	return items;
}
