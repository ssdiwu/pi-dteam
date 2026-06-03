/**
 * P4-UI 层：把 .dteam/task/*.md 解析为面板可直接消费的 ParsedPlan。
 *
 * 数据流：
 *   .md 文件 → readFileSync → extractAcceptanceModel（P0 解析器）→ ParsedPlan
 *
 * 设计依据：
 * - /docs/design-phase1-confirm-panel.md §3.3（面板布局：Goal + checklist + 文件路径 + 操作栏）
 * - 复用 src/P0/workItem.ts 的 extractAcceptanceModel（不重新实现解析）
 */

import { readFileSync } from "node:fs";
import { extractAcceptanceModel, type AcceptanceItem } from "../P0/workItem.js";

/** Plan 面板数据源（一份 task 文件 → 一个 ParsedPlan） */
export interface ParsedPlan {
	/** task 文件绝对路径 */
	taskPath: string;
	/** Goal 摘要（取首个非空行作为标题，剩余作为 body） */
	goalSummary: string;
	/** 目标全文（来自 ## 目标 section，未截断） */
	goalFull: string;
	/** A 层可校验项（可被 Root materialize 成 workItems[]） */
	machine: AcceptanceItem[];
	/** B 层人工裁决项（保留给最终 review） */
	human: string[];
}

/**
 * 从 task Markdown 路径解析出 ParsedPlan。
 *
 * @param taskPath .dteam/task/*.md 的绝对路径
 * @returns 解析结果；文件不存在或无验收条件时返回带空数组的 plan（不抛错）
 */
export function parseChecklist(taskPath: string): ParsedPlan {
	let content: string;
	try {
		content = readFileSync(taskPath, "utf-8");
	} catch {
		// 文件不存在时返回空 plan，让调用方决定如何处理
		return {
			taskPath,
			goalSummary: "(无法读取 task 文件)",
			goalFull: "",
			machine: [],
			human: [],
		};
	}

	const { machine, human } = extractAcceptanceModel(content);
	const goalFull = extractGoal(content);

	return {
		taskPath,
		goalSummary: summarizeGoal(goalFull),
		goalFull,
		machine,
		human,
	};
}

/**
 * 从 .md 提取 ## 目标 section 全文。
 * 找不到 section 时返回空串。
 */
function extractGoal(content: string): string {
	const headingRegex = /^##\s+(.+)$/gm;
	const targetRe = /^\s*目标/;
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
	if (start === null) return "";
	if (end === null) end = content.length;
	return content.slice(start, end).trim();
}

/**
 * 从 goal 全文提取面板标题用的短摘要。
 * - 取第一非空行
 * - 截断到 50 字符（超长加 …）
 */
function summarizeGoal(goalFull: string): string {
	const firstLine = goalFull.split("\n").find((l) => l.trim().length > 0) ?? "";
	const trimmed = firstLine.trim();
	if (trimmed.length <= 50) return trimmed;
	return trimmed.slice(0, 49) + "…";
}
