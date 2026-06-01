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
import pkg from "../../package.json" with { type: "json" };

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

// ── Worker Wrapper: 带TUI消息的worker工具包装 ────────────────
function wrapWorker(
	fn: (ctx: ExtensionContext, params: any) => Promise<{ content: string }>,
	workerAction: "create" | "start" | "signal" | "cancel" | "status",
	extensionApi: ExtensionAPI,
) {
	return async (
		_toolCallId: string,
		params: any,
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		ctx: ExtensionContext,
	) => {
		// 当用户没指定 model 时，自动注入当前会话的 model（参考 dflow 模式）
		if (workerAction === "create" && params.config && !params.config.model && ctx.model) {
			params = {
				...params,
				config: {
					...params.config,
					model: `${ctx.model.provider}/${ctx.model.id}`,
				},
			};
		}

		const result = await fn(ctx, params);
		
		// 解析结果，发送TUI消息
		try {
			const parsed = JSON.parse(result.content);
			const workerId = parsed.workerId || params.workerId;
			
			if (workerId) {
				let status = "pending";
				let task = "";
				
				switch (workerAction) {
					case "create":
						status = "pending";
						task = parsed.config?.task || "Worker created";
						break;
					case "start":
						status = "running";
						task = "Executing...";
						break;
					case "signal":
						status = "running";
						task = `Signal: ${params.signalType}`;
						break;
					case "cancel":
						status = "failed";
						task = "Cancelled";
						break;
					case "status":
						status = parsed.status || "unknown";
						task = "Status check";
						break;
				}
				
				// 更新 TUI 状态栏
				emitWorkerProgress(extensionApi, workerId, status as "pending" | "running" | "done" | "failed", task);

				// 更新 worker widget
				if (workerAction === "start" && parsed.background) {
					// 后台 worker：显示 widget
					showWorkerStatus(ctx, {
						status: "running",
						agent: params.executorName ?? "default",
						task: parsed.config?.task ?? "Executing...",
						toolCount: 0,
						elapsedMs: 0,
					});
				} else if (workerAction === "start" || workerAction === "cancel") {
					// 前台 worker 完成 或 取消：清除 widget
					clearWorkerStatus(ctx);
				}
			}
		} catch (e) {
			// 解析失败，记录错误但不影响主流程
			console.error("[dteam] Failed to update TUI progress:", e);
		}
		
		// 生成简洁报告
		const brief = buildBriefReport(result.content, workerAction);
		return {
			content: [{ type: "text" as const, text: brief }],
			details: undefined,
		};
	};
}

/**
 * 生成简洁报告
 */
function buildBriefReport(raw: string, action: string): string {
	try {
		const parsed = JSON.parse(raw);
		const workerId = parsed.workerId || "unknown";
		
		if (parsed.error) {
			return `❌ Worker ${workerId} 失败: ${parsed.error}`;
		}
		
		if (action === "create") {
			return `✅ Worker 已创建: ${workerId}`;
		}
		
		if (action === "start" && parsed.result) {
			const { status, conclusion } = parsed.result;
			const icon = status === "done" ? "✅" : "❌";
			const brief = conclusion ? conclusion.split("\n")[0] : "执行完成";
			return `${icon} Worker ${workerId}: ${brief}`;
		}
		
		if (action === "cancel") {
			return `🚫 Worker ${workerId} 已取消`;
		}
		
		if (action === "status") {
			return `📊 Worker ${workerId}: ${parsed.status}`;
		}
		
		return `✅ Worker ${workerId}: ${action} 完成`;
	} catch {
		return raw.substring(0, 200);
	}
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
} from "../P1/task.js";

import {
	referenceArchitecture,
} from "../P0/reference.js";

import {
	workerCreate,
	workerStart,
	workerSendSignal,
	workerCancel,
	workerStatus,
	workerSaveMemory,
	workerLoadMemory,
	workerGetMemory,
	registerExecutor,
	loadAgentRole,
	getSessionModel,
	setSessionModel,
	getConfigForContext,
} from "../P2/worker.js";
import { spawnAgent } from "../P1/spawn.js";

import { registerRenderers, emitWorkerProgress } from "./renderers.js";
import { showWorkerStatus, clearWorkerStatus } from "./worker-widget.js";
import { registerCompactionI18n } from "../P1/compaction.js";

import {
	memoryGet,
	memorySet,
	memoryKeys,
	memoryHas,
	memoryDelete,
	memoryClear,
	memorySave,
	memoryLoad,
} from "../P1/memory.js";

import {
	signalEmit,
	signalHistory,
} from "../P1/signal.js";

// ── 扩展入口 ──────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	// 注册渲染器
	registerRenderers(pi);

	// 注册 compaction i18n
	registerCompactionI18n(pi);

	// ═══════════════════════════════════════════════════════════
	// LLM executor 注册 + sessionModel 同步读（步骤 3 + 4）
	// ═══════════════════════════════════════════════════════════

	// 1. 显式“llm” executor：保留语义入口（与默认 executor 等价）
	//    默认 executor 已走真路径（步骤 2 改造 P2/worker.ts）；
	//    显式注册“llm”仅为“明确用 LLM executor”的语义。
	registerExecutor("llm", async (context) => {
		const r = await loadAgentRole(context.role);
		if (!r) return "[ERROR] agents/<role>.md not found";
		const sessionModel = getSessionModel();
		const config = getConfigForContext(context);
		const result = await spawnAgent({
			systemPrompt: r.systemPrompt,
			task: context.task,
			model: config?.model,
			fallbackModels: config?.fallbackModels,
			sessionModel,
			tools: r.tools,
			cwd: context.cwd,
		});
		if (result.exitCode !== 0 || result.errorMessage) {
			const prefix = result.isModelError ? "[MODEL_ERROR]" : "[ERROR]";
			context.bus.emit("blocked", context.role, {
				status: result.isModelError ? "model_error" : "spawn_error",
				error: result.errorMessage || "spawn failed",
				model: result.model,
				isModelError: result.isModelError ?? false,
			});
			return `${prefix} ${result.errorMessage || "spawn failed"}\n\n[Partial]:\n${result.output || "(empty)"}`;
		}
		return result.output || "(empty)";
	});

	// 2. sessionModel 同步读：session_start 和 model_select 事件触发时更新闭包。
	//    默认 executor 调 spawnAgent 时通过 getSessionModel() 同步读。
	pi.on("session_start", (_event, ctx) => {
		if (ctx.model) {
			setSessionModel(`${ctx.model.provider}/${ctx.model.id}`);
		}
	});

	pi.on("model_select", (event) => {
		if (event.model) {
			setSessionModel(`${event.model.provider}/${event.model.id}`);
		}
	});

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
		description: "创建 worker 实例。用于复杂任务的执行，提供更好的上下文管理和协作能力。",
		promptSnippet: "- worker_create: 创建 worker 实例",
		promptGuidelines: [
			"当任务复杂（>30分钟，多文件修改，需要上下文积累）时，使用 worker_create 创建 worker 实例。",
			"worker 提供共享内存、信号通信、执行上下文构建等能力，适合需要多角色协作的场景。",
			"简单任务（<30分钟，单文件修改）可以直接执行，不需要 worker。"
		],
		parameters: {
			type: "object",
			properties: {
				config: {
					type: "object",
					description: "WorkerConfig 配置",
					properties: {
						type: { type: "string", enum: ["solo", "chain", "team"], description: "worker 类型" },
						task: { type: "string", description: "任务描述" },
						style: { type: "string", description: "执行风格" },
						options: {
							type: "array",
							description: "WorkerOption 数组",
							items: {
								type: "object",
								properties: {
									type: { type: "string", description: "选项类型" },
									value: { description: "选项值" },
								},
								required: ["type", "value"],
							},
						},
						model: { type: "string", description: "LLM 模型，格式 provider/id" },
						fallbackModels: { type: "array", items: { type: "string" }, description: "Fallback 模型链" },
					},
					required: ["type", "task", "style"],
				},
			},
			required: ["config"],
			additionalProperties: false,
		} as const,
		execute: wrapWorker(workerCreate, "create", pi),
	});

	pi.registerTool({
		name: "worker_start",
		label: "Worker Start",
		description: "启动 worker 执行。支持前台和后台执行模式。",
		promptSnippet: "- worker_start: 启动 worker 执行",
		promptGuidelines: [
			"使用 worker_start 启动 worker 执行，需要提供 workerId 参数。",
			"设置 background: true 可以后台执行，不阻塞当前流程。",
			"设置 executorName 可以使用自定义执行器。"
		],
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
		execute: wrapWorker(workerStart, "start", pi),
	});

	pi.registerTool({
		name: "worker_sendSignal",
		label: "Worker Send Signal",
		description: "发送信号到 worker。用于实时通信和状态报告。",
		promptSnippet: "- worker_sendSignal: 发送信号到 worker",
		promptGuidelines: [
			"使用 worker_sendSignal 发送信号到 worker，需要提供 workerId、signalType、data 参数。",
			"信号类型包括：progress（进度）、blocked（阻塞）、found（发现）、help（求助）。",
			"用于向 worker 报告执行状态或接收 worker 的反馈。"
		],
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
		execute: wrapWorker(workerSendSignal, "signal", pi),
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
		execute: wrapWorker(workerCancel, "cancel", pi),
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
		execute: wrapWorker(workerStatus, "status", pi),
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
		description: "获取共享内存内容。用于访问 worker 的执行上下文和共享数据。",
		promptSnippet: "- worker_getMemory: 获取共享内存内容",
		promptGuidelines: [
			"使用 worker_getMemory 获取共享内存内容，可选提供 namespace 和 key 参数。",
			"不提供参数：获取所有命名空间列表。",
			"提供 namespace：获取该命名空间下的所有键值对。",
			"提供 namespace 和 key：获取特定键的值。"
		],
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
			ctx.ui.notify(`dteam v${pkg.version} active`, "info");
		},
	});
}
