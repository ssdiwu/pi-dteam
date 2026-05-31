/**
 * pi-dteam Extension — 轻量级多代理编排系统入口
 *
 * 7个工具（task_create/read/update/complete/archive/list/search）+ 2个reference工具
 * 6个agent（explore/design/build/deploy/check/close）
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
} from "../tools/reference.js";

import {
	workerCreate,
	workerStart,
	workerSendSignal,
	workerCancel,
	workerStatus,
	workerSaveMemory,
	workerLoadMemory,
	workerGetMemory,
} from "../tools/worker.js";

import { registerRenderers } from "./renderers.js";

import {
	authRegister,
	authLogin,
	authVerify,
	authRefresh,
	authLogout,
} from "../tools/auth.js";

import {
	memoryGet,
	memorySet,
	memoryKeys,
	memoryHas,
	memoryDelete,
	memoryClear,
	memorySave,
	memoryLoad,
} from "../tools/memory.js";

import {
	signalEmit,
	signalHistory,
} from "../tools/signal.js";

// ── 扩展入口 ──────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	// 注册渲染器
	registerRenderers(pi);
	// ═══════════════════════════════════════════════════════════
	// task 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "task_create",
		label: "Task Create",
		description: "创建新的 task。",
		promptSnippet: "- task_create: 创建新的 task",
		promptGuidelines: ["使用 task_create 创建新的 task，需要提供 name、type、why、goal 参数。"],
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
		name: "task_read",
		label: "Task Read",
		description: "读取 task 的指定 section。",
		promptSnippet: "- task_read: 读取 task 的指定 section",
		promptGuidelines: ["使用 task_read 读取 task 的指定 section，需要提供 id 和 section 参数。"],
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
		name: "task_update",
		label: "Task Update",
		description: "更新 task 的指定 section。",
		promptSnippet: "- task_update: 更新 task 的指定 section",
		promptGuidelines: ["使用 task_update 更新 task 的指定 section，需要提供 id、section 和 content 参数。"],
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
		name: "task_complete",
		label: "Task Complete",
		description: "标记 checklist 项为完成。",
		promptSnippet: "- task_complete: 标记 checklist 项为完成",
		promptGuidelines: ["使用 task_complete 标记 checklist 项为完成，需要提供 id 和 item 参数。"],
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
		name: "task_archive",
		label: "Task Archive",
		description: "归档完成的任务。",
		promptSnippet: "- task_archive: 归档完成的任务",
		promptGuidelines: ["使用 task_archive 归档完成的任务，需要提供 id 参数。"],
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
		name: "task_list",
		label: "Task List",
		description: "列出所有 task。",
		promptSnippet: "- task_list: 列出所有 task",
		promptGuidelines: ["使用 task_list 列出所有 task，可选按状态过滤。"],
		parameters: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: ["todo", "InSpec", "InProgress", "InDeploy", "Done", "Cancelled"],
					description: "按状态过滤（可选）",
				},
			},
			additionalProperties: false,
		} as const,
		execute: wrap(taskList),
	});

	pi.registerTool({
		name: "task_search",
		label: "Task Search",
		description: "搜索 task。",
		promptSnippet: "- task_search: 搜索 task",
		promptGuidelines: ["使用 task_search 搜索 task，需要提供 query 参数。"],
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
		name: "reference_architecture",
		label: "Reference Architecture",
		description: "查询架构类型参考。",
		promptSnippet: "- reference_architecture: 查询架构类型参考",
		promptGuidelines: ["使用 reference_architecture 查询架构类型参考，需要提供 query 参数。"],
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

	// ═══════════════════════════════════════════════════════════
	// worker 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "worker_create",
		label: "Worker Create",
		description: "创建 worker 实例。",
		promptSnippet: "- worker_create: 创建 worker 实例",
		promptGuidelines: ["使用 worker_create 创建 worker 实例，需要提供 config 参数。"],
		parameters: {
			type: "object",
			properties: {
				config: { type: "object", description: "WorkerConfig 配置" },
			},
			required: ["config"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerCreate),
	});

	pi.registerTool({
		name: "worker_start",
		label: "Worker Start",
		description: "启动 worker 执行。",
		promptSnippet: "- worker_start: 启动 worker 执行",
		promptGuidelines: ["使用 worker_start 启动 worker 执行，需要提供 workerId 参数，可选 background、executorName。"],
		parameters: {
			type: "object",
			properties: {
				workerId: { type: "string", description: "Worker ID" },
				executorName: { type: "string", description: "自定义执行器名称（可选）" },
				background: { type: "boolean", description: "是否后台执行（可选）" },
			},
			required: ["workerId"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerStart),
	});

	pi.registerTool({
		name: "worker_sendSignal",
		label: "Worker Send Signal",
		description: "发送信号到 worker。",
		promptSnippet: "- worker_sendSignal: 发送信号到 worker",
		promptGuidelines: ["使用 worker_sendSignal 发送信号到 worker，需要提供 workerId、signalType、data 参数。"],
		parameters: {
			type: "object",
			properties: {
				workerId: { type: "string", description: "Worker ID" },
				signalType: { type: "string", enum: ["progress", "blocked", "found", "help"], description: "信号类型" },
				data: { type: "object", description: "信号数据" },
			},
			required: ["workerId", "signalType"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerSendSignal),
	});

	pi.registerTool({
		name: "worker_cancel",
		label: "Worker Cancel",
		description: "取消后台执行的 worker。",
		promptSnippet: "- worker_cancel: 取消后台执行的 worker",
		promptGuidelines: ["使用 worker_cancel 取消后台执行的 worker，需要提供 workerId 参数。"],
		parameters: {
			type: "object",
			properties: {
				workerId: { type: "string", description: "Worker ID" },
			},
			required: ["workerId"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerCancel),
	});

	pi.registerTool({
		name: "worker_status",
		label: "Worker Status",
		description: "获取 worker 状态。",
		promptSnippet: "- worker_status: 获取 worker 状态",
		promptGuidelines: ["使用 worker_status 获取 worker 状态，需要提供 workerId 参数。"],
		parameters: {
			type: "object",
			properties: {
				workerId: { type: "string", description: "Worker ID" },
			},
			required: ["workerId"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerStatus),
	});

	pi.registerTool({
		name: "worker_saveMemory",
		label: "Worker Save Memory",
		description: "保存共享内存到文件。",
		promptSnippet: "- worker_saveMemory: 保存共享内存到文件",
		promptGuidelines: ["使用 worker_saveMemory 保存共享内存到文件，需要提供 filepath 参数。"],
		parameters: {
			type: "object",
			properties: {
				filepath: { type: "string", description: "文件路径" },
			},
			required: ["filepath"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerSaveMemory),
	});

	pi.registerTool({
		name: "worker_loadMemory",
		label: "Worker Load Memory",
		description: "从文件加载共享内存。",
		promptSnippet: "- worker_loadMemory: 从文件加载共享内存",
		promptGuidelines: ["使用 worker_loadMemory 从文件加载共享内存，需要提供 filepath 参数。"],
		parameters: {
			type: "object",
			properties: {
				filepath: { type: "string", description: "文件路径" },
			},
			required: ["filepath"],
			additionalProperties: false,
		} as const,
		execute: wrap(workerLoadMemory),
	});

	pi.registerTool({
		name: "worker_getMemory",
		label: "Worker Get Memory",
		description: "获取共享内存内容。",
		promptSnippet: "- worker_getMemory: 获取共享内存内容",
		promptGuidelines: ["使用 worker_getMemory 获取共享内存内容，可选提供 namespace 和 key 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间（可选）" },
				key: { type: "string", description: "键名（可选）" },
			},
			additionalProperties: false,
		} as const,
		execute: wrap(workerGetMemory),
	});

	// ═══════════════════════════════════════════════════════════
	// auth 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "auth_register",
		label: "Auth Register",
		description: "用户注册。",
		promptSnippet: "- auth_register: 用户注册",
		promptGuidelines: ["使用 auth_register 进行用户注册，需要提供 username、email、password 参数。"],
		parameters: {
			type: "object",
			properties: {
				username: { type: "string", description: "用户名" },
				email: { type: "string", description: "邮箱" },
				password: { type: "string", description: "密码" },
			},
			required: ["username", "email", "password"],
			additionalProperties: false,
		} as const,
		execute: wrap(authRegister),
	});

	pi.registerTool({
		name: "auth_login",
		label: "Auth Login",
		description: "用户登录。",
		promptSnippet: "- auth_login: 用户登录",
		promptGuidelines: ["使用 auth_login 进行用户登录，需要提供 username、password 参数。"],
		parameters: {
			type: "object",
			properties: {
				username: { type: "string", description: "用户名" },
				password: { type: "string", description: "密码" },
			},
			required: ["username", "password"],
			additionalProperties: false,
		} as const,
		execute: wrap(authLogin),
	});

	pi.registerTool({
		name: "auth_verify",
		label: "Auth Verify",
		description: "验证token。",
		promptSnippet: "- auth_verify: 验证token",
		promptGuidelines: ["使用 auth_verify 验证token，需要提供 token 参数。"],
		parameters: {
			type: "object",
			properties: {
				token: { type: "string", description: "JWT token" },
			},
			required: ["token"],
			additionalProperties: false,
		} as const,
		execute: wrap(authVerify),
	});

	pi.registerTool({
		name: "auth_refresh",
		label: "Auth Refresh",
		description: "刷新token。",
		promptSnippet: "- auth_refresh: 刷新token",
		promptGuidelines: ["使用 auth_refresh 刷新token，需要提供 refreshToken 参数。"],
		parameters: {
			type: "object",
			properties: {
				refreshToken: { type: "string", description: "刷新token" },
			},
			required: ["refreshToken"],
			additionalProperties: false,
		} as const,
		execute: wrap(authRefresh),
	});

	pi.registerTool({
		name: "auth_logout",
		label: "Auth Logout",
		description: "用户登出。",
		promptSnippet: "- auth_logout: 用户登出",
		promptGuidelines: ["使用 auth_logout 进行用户登出，需要提供 refreshToken 参数。"],
		parameters: {
			type: "object",
			properties: {
				refreshToken: { type: "string", description: "刷新token" },
			},
			required: ["refreshToken"],
			additionalProperties: false,
		} as const,
		execute: wrap(authLogout),
	});

	// ═══════════════════════════════════════════════════════════
	// memory 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "memory_get",
		label: "Memory Get",
		description: "从共享内存获取值。",
		promptSnippet: "- memory_get: 从共享内存获取值",
		promptGuidelines: ["使用 memory_get 从共享内存获取值，需要提供 namespace 和 key 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
				key: { type: "string", description: "键名" },
			},
			required: ["namespace", "key"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryGet),
	});

	pi.registerTool({
		name: "memory_set",
		label: "Memory Set",
		description: "向共享内存设置值。",
		promptSnippet: "- memory_set: 向共享内存设置值",
		promptGuidelines: ["使用 memory_set 向共享内存设置值，需要提供 namespace、key、value、agentId 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
				key: { type: "string", description: "键名" },
				value: { description: "值" },  // type 省略（允许任意类型）
				agentId: { type: "string", description: "代理ID" },
			},
			required: ["namespace", "key", "value", "agentId"],
			additionalProperties: false,
		} as const,
		execute: wrap(memorySet),
	});

	pi.registerTool({
		name: "memory_keys",
		label: "Memory Keys",
		description: "列出命名空间下的所有键。",
		promptSnippet: "- memory_keys: 列出命名空间下的所有键",
		promptGuidelines: ["使用 memory_keys 列出命名空间下的所有键，需要提供 namespace 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
			},
			required: ["namespace"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryKeys),
	});

	pi.registerTool({
		name: "memory_has",
		label: "Memory Has",
		description: "检查键是否存在。",
		promptSnippet: "- memory_has: 检查键是否存在",
		promptGuidelines: ["使用 memory_has 检查键是否存在，需要提供 namespace 和 key 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
				key: { type: "string", description: "键名" },
			},
			required: ["namespace", "key"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryHas),
	});

	pi.registerTool({
		name: "memory_delete",
		label: "Memory Delete",
		description: "删除键。",
		promptSnippet: "- memory_delete: 删除键",
		promptGuidelines: ["使用 memory_delete 删除键，需要提供 namespace 和 key 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
				key: { type: "string", description: "键名" },
			},
			required: ["namespace", "key"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryDelete),
	});

	pi.registerTool({
		name: "memory_clear",
		label: "Memory Clear",
		description: "清空命名空间。",
		promptSnippet: "- memory_clear: 清空命名空间",
		promptGuidelines: ["使用 memory_clear 清空命名空间，需要提供 namespace 参数。"],
		parameters: {
			type: "object",
			properties: {
				namespace: { type: "string", description: "命名空间" },
			},
			required: ["namespace"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryClear),
	});

	pi.registerTool({
		name: "memory_save",
		label: "Memory Save",
		description: "保存共享内存到文件。",
		promptSnippet: "- memory_save: 保存共享内存到文件",
		promptGuidelines: ["使用 memory_save 保存共享内存到文件，需要提供 filepath 参数。"],
		parameters: {
			type: "object",
			properties: {
				filepath: { type: "string", description: "文件路径" },
			},
			required: ["filepath"],
			additionalProperties: false,
		} as const,
		execute: wrap(memorySave),
	});

	pi.registerTool({
		name: "memory_load",
		label: "Memory Load",
		description: "从文件加载共享内存。",
		promptSnippet: "- memory_load: 从文件加载共享内存",
		promptGuidelines: ["使用 memory_load 从文件加载共享内存，需要提供 filepath 参数。"],
		parameters: {
			type: "object",
			properties: {
				filepath: { type: "string", description: "文件路径" },
			},
			required: ["filepath"],
			additionalProperties: false,
		} as const,
		execute: wrap(memoryLoad),
	});

	// ═══════════════════════════════════════════════════════════
	// signal 工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "signal_emit",
		label: "Signal Emit",
		description: "发送信号。",
		promptSnippet: "- signal_emit: 发送信号",
		promptGuidelines: ["使用 signal_emit 发送信号，需要提供 type、workerId 参数。"],
		parameters: {
			type: "object",
			properties: {
				type: { type: "string", enum: ["progress", "blocked", "found", "help"], description: "信号类型" },
				workerId: { type: "string", description: "工作者ID" },
				data: { type: "object", description: "信号数据" },
			},
			required: ["type", "workerId"],
			additionalProperties: false,
		} as const,
		execute: wrap(signalEmit),
	});

	pi.registerTool({
		name: "signal_history",
		label: "Signal History",
		description: "获取信号历史。",
		promptSnippet: "- signal_history: 获取信号历史",
		promptGuidelines: ["使用 signal_history 获取信号历史，可选提供 workerId 参数。"],
		parameters: {
			type: "object",
			properties: {
				workerId: { type: "string", description: "工作者ID" },
			},
			additionalProperties: false,
		} as const,
		execute: wrap(signalHistory),
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
