/**
 * pi-dteam Extension — 轻量级多代理编排系统入口
 *
 * 7个工具（task.create/read/update/complete/archive/list/search）+ 2个reference工具
 * 5个agent（explore/design/build/check/close）
 * 4个信号 + 5个策略 = 9种信号类型
 */

import type {
	ExtensionAPI,
	ToolCallEvent,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Wrapper: tool handler → agent-tool-result shape ────────────
// tools return { content: string }. This helper wraps
// them into the shape that registerTool execute expects.
function wrap(
	fn: (ctx: ExtensionContext, params: any) => Promise<{ content: string }>,
) {
	return async (
		_toolCallId: string,
		params: any,
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		ctx: ExtensionContext,
	) => {
		const result = await fn(ctx, params);
		return {
			content: [{ type: "text" as const, text: result.content }],
			details: undefined,
		};
	};
}

// ── 工具实现 ──────────────────────────────────────────────────
import {
	taskCreate,
	taskRead,
	taskUpdate,
	taskComplete,
	taskArchive,
	taskList,
	taskSearch,
} from "../tools/task.js";

import {
	referenceArchitecture,
	referenceThinking,
} from "../tools/reference.js";

// ── 扩展入口 ──────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	// ═══════════════════════════════════════════════════════════
	// task 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "task.create",
		label: "Task Create",
		description: "创建新的 task。",
		promptSnippet: "- task.create: 创建新的 task",
		promptGuidelines: ["使用 task.create 创建新的 task，需要提供 name、type、why、goal 参数。"],
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "任务名称" },
				type: {
					type: "string",
					enum: ["functional", "ui", "bugfix", "refactor", "infra"],
					description: "任务类型",
				},
				why: { type: "string", description: "为什么要做" },
				goal: { type: "string", description: "目标是什么" },
			},
			required: ["name", "type", "why", "goal"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskCreate),
	});

	pi.registerTool({
		name: "task.read",
		label: "Task Read",
		description: "读取 task 的指定 section。",
		promptSnippet: "- task.read: 读取 task 的指定 section",
		promptGuidelines: ["使用 task.read 读取 task 的指定 section，需要提供 id 和 section 参数。"],
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务ID" },
				section: {
					type: "string",
					enum: ["基本信息", "目标", "范围", "验收条件", "阶段记录"],
					description: "section名称",
				},
			},
			required: ["id", "section"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskRead),
	});

	pi.registerTool({
		name: "task.update",
		label: "Task Update",
		description: "更新 task 的指定 section。",
		promptSnippet: "- task.update: 更新 task 的指定 section",
		promptGuidelines: ["使用 task.update 更新 task 的指定 section，需要提供 id、section 和 content 参数。"],
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务ID" },
				section: { type: "string", description: "section名称" },
				content: { type: "string", description: "新内容" },
			},
			required: ["id", "section", "content"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskUpdate),
	});

	pi.registerTool({
		name: "task.complete",
		label: "Task Complete",
		description: "标记 checklist 项为完成。",
		promptSnippet: "- task.complete: 标记 checklist 项为完成",
		promptGuidelines: ["使用 task.complete 标记 checklist 项为完成，需要提供 id 和 item 参数。"],
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务ID" },
				item: { type: "string", description: "checklist项内容" },
			},
			required: ["id", "item"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskComplete),
	});

	pi.registerTool({
		name: "task.archive",
		label: "Task Archive",
		description: "归档完成的任务。",
		promptSnippet: "- task.archive: 归档完成的任务",
		promptGuidelines: ["使用 task.archive 归档完成的任务，需要提供 id 参数。"],
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "任务ID" },
			},
			required: ["id"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskArchive),
	});

	pi.registerTool({
		name: "task.list",
		label: "Task List",
		description: "列出所有 task。",
		promptSnippet: "- task.list: 列出所有 task",
		promptGuidelines: ["使用 task.list 列出所有 task，可选按状态过滤。"],
		parameters: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: ["todo", "InSpec", "InProgress", "Done", "Cancelled"],
					description: "按状态过滤（可选）",
				},
			},
			additionalProperties: false,
		} as const,
		execute: wrap(taskList),
	});

	pi.registerTool({
		name: "task.search",
		label: "Task Search",
		description: "搜索 task。",
		promptSnippet: "- task.search: 搜索 task",
		promptGuidelines: ["使用 task.search 搜索 task，需要提供 query 参数。"],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索关键词" },
			},
			required: ["query"],
			additionalProperties: false,
		} as const,
		execute: wrap(taskSearch),
	});

	// ═══════════════════════════════════════════════════════════
	// reference 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "reference.architecture",
		label: "Reference Architecture",
		description: "查询架构类型参考。",
		promptSnippet: "- reference.architecture: 查询架构类型参考",
		promptGuidelines: ["使用 reference.architecture 查询架构类型参考，需要提供 query 参数。"],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "查询关键词" },
			},
			required: ["query"],
			additionalProperties: false,
		} as const,
		execute: wrap(referenceArchitecture),
	});

	pi.registerTool({
		name: "reference.thinking",
		label: "Reference Thinking",
		description: "查询思考方式参考。",
		promptSnippet: "- reference.thinking: 查询思考方式参考",
		promptGuidelines: ["使用 reference.thinking 查询思考方式参考，需要提供 query 参数。"],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "查询关键词" },
			},
			required: ["query"],
			additionalProperties: false,
		} as const,
		execute: wrap(referenceThinking),
	});

	// ═══════════════════════════════════════════════════════════
	// 命令注册
	// ═══════════════════════════════════════════════════════════

	pi.registerCommand("dteam", {
		description: "显示 dteam 状态",
		async handler(_args: string, ctx) {
			ctx.ui.notify("dteam v0.1.0 active", "info");
		},
	});
}
