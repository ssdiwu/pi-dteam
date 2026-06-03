/**
 * P3-组织层：workItem 规划器
 *
 * 把 task 双层验收条件的 A 层 materialize 成运行态任务池 workItems[]，
 * 并提供 claim / refresh / projection 四个核心操作。
 *
 * v1 规则（详见 workItem-v1-实现稿.md）：
 * - materialize: A 层每条 AC → 一个 workItem；B 层不进 workItems[]
 * - refresh: dependsOn 全 done 的 todo → ready
 * - claim: 取第一个 ready，按 task.md 原顺序
 * - projection: checklistStatus 完全从 workItems[] 派生，不另维护
 *
 * 约束：
 * - 全部为纯函数（无 fs / 无副作用）
 * - 不修改入参数组；返回新数组或新对象
 */

import type {
	AcceptanceModel,
	ChecklistStatus,
	WorkItem,
} from "../P0/workItem.js";

// ── 内部工具 ──────────────────────────────────────────────────

/**
 * 标题截断到 80 字符以内，避免面板过宽。
 * 输入 acText 为空时回退 acId。
 */
function makeTitle(acText: string, acId: string): string {
	const trimmed = acText.trim();
	if (trimmed.length === 0) return acId;
	return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

// ── 1. materialize ────────────────────────────────────────────

/**
 * 把 A 层可校验项 materialize 成 workItems[]。
 *
 * @param input.taskPath 源 task 文件路径（写入 source.taskPath，便于追溯）
 * @param input.acceptance 由 `extractAcceptanceModel()` 解析出的双层模型
 * @param input.now 注入当前时间（默认 new Date().toISOString()，便于测试）
 * @returns workItems[]（按 A 层出现顺序）
 */
export function materializeTaskToWorkItems(input: {
	taskPath: string;
	acceptance: AcceptanceModel;
	now?: string;
}): WorkItem[] {
	const now = input.now ?? new Date().toISOString();
	const items: WorkItem[] = [];

	for (const ac of input.acceptance.machine) {
		items.push({
			id: ac.acId,
			source: {
				kind: "acceptance",
				taskPath: input.taskPath,
				acId: ac.acId,
				acText: ac.acText,
			},
			title: makeTitle(ac.acText, ac.acId),
			acceptance: [ac.acText],
			status: "todo",
			dependsOn: [],
			attempts: [],
			helpers: [],
			createdAt: now,
			updatedAt: now,
		});
	}

	return items;
}

// ── 2. refreshReadiness ───────────────────────────────────────

/**
 * 刷新 workItems 队列的就绪状态。
 *
 * 规则：
 * - 仅作用于 `status === "todo"` 的项
 * - dependsOn 全为 `done` → 升级为 `ready`
 * - 其余原样返回
 *
 * @returns 新数组（不修改入参）
 */
export function refreshWorkItemReadiness(items: WorkItem[]): WorkItem[] {
	const statusById = new Map<string, WorkItem["status"]>();
	for (const it of items) statusById.set(it.id, it.status);

	return items.map((it) => {
		if (it.status !== "todo") return it;
		if (it.dependsOn.length === 0) {
			return { ...it, status: "ready", updatedAt: new Date().toISOString() };
		}
		const allDone = it.dependsOn.every((dep) => statusById.get(dep) === "done");
		if (allDone) {
			return { ...it, status: "ready", updatedAt: new Date().toISOString() };
		}
		return it;
	});
}

// ── 3. claim ──────────────────────────────────────────────────

/**
 * 领取下一个 ready 的 workItem。
 *
 * 规则：
 * - 只看 `status === "ready"`
 * - 按数组顺序取第一个（与 task.md 原顺序一致）
 * - 不做优先级、不做局部优化
 *
 * @returns 第一个 ready 项；没有则 null
 */
export function claimNextWorkItem(items: WorkItem[]): WorkItem | null {
	return items.find((it) => it.status === "ready") ?? null;
}

// ── 4. projection ─────────────────────────────────────────────

/**
 * 从 workItems[] 投影出面板简视图 checklistStatus。
 *
 * 规则：
 * - 完全从 workItems[] 派生，不允许单独维护
 * - workerId 仅在 ownerWorkerId 已设置时返回
 *
 * @returns 投影数组（按 workItems 顺序）
 */
export function projectChecklistStatus(items: WorkItem[]): ChecklistStatus[] {
	return items.map((it) => {
		const entry: ChecklistStatus = {
			id: it.id,
			text: it.title,
			status: it.status,
		};
		if (it.ownerWorkerId !== undefined) {
			entry.workerId = it.ownerWorkerId;
		}
		return entry;
	});
}
