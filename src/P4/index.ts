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
import { Text, Markdown } from "@earendil-works/pi-tui";
import { keyHint, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
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
		// 当用户没指定 model 时，按优先级注入
		if (workerAction === "create" && params.config && !params.config.model) {
			// 优先从 options 获取 role，否则尝试从 task 推断
			let role = params.config.options?.find((o: any) => o.type === "role")?.value as string | undefined;
			if (!role && params.config.task) {
				// 从 task 描述推断角色：explore/design/build/deploy/check/close
				const taskLower = params.config.task.toLowerCase();
				const rolePatterns: [RegExp, string][] = [
					[/explore|探索|调研|搜集|分析/i, "explore"],
					[/design|设计|方案|架构/i, "design"],
					[/build|实现|开发|编码|编写|修复|重构/i, "build"],
					[/deploy|部署|发布|上线/i, "deploy"],
					[/check|检查|验证|测试|review/i, "check"],
					[/close|收口|总结|归档/i, "close"],
				];
				for (const [pattern, r] of rolePatterns) {
					if (pattern.test(taskLower)) {
						role = r;
						break;
					}
				}
			}

			let model: string | undefined;
			let fallbackModels: string[] | undefined;

			try {
				const { loadDteamConfig } = await import("../P0/dteamConfig.js");
				const config = await loadDteamConfig(ctx.cwd);

				if (config.useCurrentModel) {
					// useCurrentModel=true：直接用 ctx.model
					model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
				} else {
					// useCurrentModel=false：dconfig models → fallbackModels → ctx.model
					if (role) {
						model = config.models[role];
						fallbackModels = config.fallbackModels[role];
					}
					if (!model && ctx.model) model = `${ctx.model.provider}/${ctx.model.id}`;
				}
			} catch {
				// 配置加载失败，fallback 到 ctx.model
				if (ctx.model) model = `${ctx.model.provider}/${ctx.model.id}`;
			}

			if (model || fallbackModels) {
				params = { ...params, config: { ...params.config, ...(model && { model }), ...(fallbackModels && { fallbackModels }) } };
			}
		}

		// 为 worker start 注入进度回调（闭包绑定 workerId） + 终态回调
		// 关键修复：onProgress/onComplete 必须用 workerId 闭包绑定，
		// 否则 store / register 拿不到正确的 workerId
		let preCreatedWorkerId: string | undefined;
		if (workerAction === "create") {
			// worker_create 返回的 workerId 在 result.content 里，预先解析出来
			// 后续如果用户立即调 worker_start，可以拿到
			// 这里不强制处理（worker_start 自身会解析）
		}

		const effectiveParams = workerAction === "start"
			? {
				...params,
				onProgress: params.workerId
					? (p: import("../P1/spawn.js").AgentProgress) => updateAgentProgress(params.workerId, p)
					: undefined,
				onComplete: params.workerId
					? (status: "done" | "failed", error?: string) => {
						registerWorkerTerminated(params.workerId, status, error);
					}
					: undefined,
			}
			: params;
		const result = await fn(ctx, effectiveParams);

		// 解析结果，发送TUI消息
		try {
			const parsed = JSON.parse(result.content);
			const workerId = parsed.workerId || params.workerId;

			if (workerId) {
				let status: "pending" | "running" | "done" | "failed" = "pending";
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
				emitWorkerProgress(extensionApi, workerId, status, task);

				// 更新 worker widget
				if (workerAction === "start" && parsed.background) {
					// 后台 worker：显示 widget（首次注册到 store）
					// 关键修复：传 workerId 作为 store 主键（之前没传，所有 worker 都被合并到 "unknown"）
					showWorkerStatus(ctx, workerId, {
						status: "running",
						agent: params.executorName ?? "default",
						task: parsed.config?.task ?? "Executing...",
						toolCount: 0,
						elapsedMs: 0,
					} as any);
				} else if (workerAction === "start" || workerAction === "cancel") {
					// 前台 worker 完成 或 取消：标记终态 + 调度清理
					registerWorkerTerminated(workerId, status === "failed" ? "failed" : "done");
				}
			}
		} catch (e) {
			// 解析失败，记录错误但不影响主流程
			console.error("[dteam] Failed to update TUI progress:", e);
		}
		
		// 生成简洁报告
		const brief = buildBriefReport(result.content, workerAction);
		// 解析原始 JSON，供给 renderResult 展开态用（details.full）
		let parsedJson: unknown = null;
		try {
			parsedJson = JSON.parse(result.content);
		} catch {
			parsedJson = null;
		}
		return {
			content: [{ type: "text" as const, text: brief }],
			details: { brief, full: parsedJson },
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
	bus as workerBus,
} from "../P2/worker.js";
import { spawnAgent } from "../P1/spawn.js";

import { registerRenderers, emitWorkerProgress } from "./renderers.js";
import { showWorkerStatus, clearWorkerStatus, updateAgentProgress, registerWorkerTerminated, showWorkerPanel, installSignalBridge } from "./worker-widget.js";
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

import {
	handleDteamAction,
} from "./dteamTool.js";

// ── 扩展入口 ──────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	// 注册渲染器
	registerRenderers(pi);

	// 注册 compaction i18n
	registerCompactionI18n(pi);

	// 安装信号桥接（bus → WorkerProgressStore）
	installSignalBridge(workerBus as any);

	// 不注册快捷键——展开 widget 用 /dteam command（P4/index.ts:951 已存在）
	// 避免快捷键冲突 + 用户输入 / 时能看到 command 列表（可发现性）

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
		renderResult: makeTextRenderer((p) => `✓ Task created: ${p?.id ?? "?"}`),
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
		renderResult: makeMarkdownRenderer((p) => `✓ Read ${p?.section ?? "section"}`),
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
		renderResult: makeTextRenderer(() => "✓ Task updated"),
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
		renderResult: makeTextRenderer(() => "✓ Item completed"),
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
		renderResult: makeTextRenderer(() => "✓ Task archived"),
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
		renderResult: makeTextRenderer((p) => {
			const n = Array.isArray(p?.tasks) ? p.tasks.length : 0;
			return `✓ ${n} task${n === 1 ? "" : "s"}`;
		}),
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
		renderResult: makeTextRenderer((p) => {
			const n = Array.isArray(p?.tasks) ? p.tasks.length : 0;
			return `✓ ${n} task${n === 1 ? "" : "s"} found`;
		}),
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
		renderResult: makeMarkdownRenderer(() => "✓ Reference loaded"),
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
			"简单任务（<30分钟，单文件修改）可以直接执行，不需要 worker。",
			"**重要**：必须在 options 中提供 role 选项（type='role'），指定执行角色（explore/design/build/deploy/check/close），以便从 dconfig.json 加载对应的 model 配置。"
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
		renderResult: makeWorkerRenderer(),
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
		renderResult: makeWorkerRenderer(),
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
		renderResult: makeWorkerRenderer(),
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
		renderResult: makeWorkerRenderer(),
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
		renderResult: makeWorkerRenderer(),
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
		renderResult: makeTextRenderer(() => "✓ Worker memory saved"),
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
		renderResult: makeTextRenderer(() => "✓ Loaded worker memory"),
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
		renderResult: makeTextRenderer(() => "✓ Got worker memory"),
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
		renderResult: makeTextRenderer((p) => {
			const v = p?.value;
			if (typeof v === "string") return `✓ ${v.length > 60 ? v.slice(0, 57) + "…" : v}`;
			return "✓ Value retrieved";
		}),
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
		renderResult: makeTextRenderer(() => "✓ Memory set"),
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
		renderResult: makeTextRenderer((p) => {
			const n = Array.isArray(p?.keys) ? p.keys.length : 0;
			return `✓ ${n} key${n === 1 ? "" : "s"}`;
		}),
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
		renderResult: makeTextRenderer((p) => p?.value === true ? "✓ Exists" : p?.value === false ? "✗ Absent" : "✓ Checked"),
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
		renderResult: makeTextRenderer(() => "✓ Memory deleted"),
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
		renderResult: makeTextRenderer(() => "✓ Memory cleared"),
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
		renderResult: makeTextRenderer(() => "✓ Memory saved"),
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
		renderResult: makeTextRenderer((p) => `✓ Loaded ${p?.keys?.length ?? 0} keys`),
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
		renderResult: makeTextRenderer((p) => `✓ Signal ${p?.type ?? "?"} emitted`),
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
		renderResult: makeTextRenderer((p) => {
			const n = Array.isArray(p?.history) ? p.history.length : 0;
			return `✓ ${n} signal${n === 1 ? "" : "s"}`;
		}),
	});

	// ═══════════════════════════════════════════════════════════
	// 命令注册
	// ═══════════════════════════════════════════════════════════

	// ═══════════════════════════════════════════════════════════
	// dteam 调度入口工具
	// ═══════════════════════════════════════════════════════════

	pi.registerTool({
		name: "dteam",
		label: "Dteam Scheduler",
		description: "dteam 调度入口工具。让主 LLM 自动选角色、组装 worker、决定执行模式。",
		promptSnippet: "- dteam: dteam 调度入口，支持 list/plan/run/status 4 个 action",
		promptGuidelines: [
			"action=list：列出所有 dteam 角色及其能力",
			"action=plan：根据目标推断执行计划，或通过 taskId 从 task 文件自动生成 chain plan",
			"action=run：创建 worker 并后台启动执行",
			"action=status：查询 worker 运行状态",
			"run 后用 status 查询进度，用 workerId 标识",
		],
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "plan", "run", "status"],
					description: "要执行的操作",
				},
				goal: {
					type: "string",
					description: "目标描述（plan/run 可选）",
				},
				taskId: {
					type: "string",
					description: "task id（plan 可选，从 task Markdown 自动生成 chain plan）",
				},
				agents: {
					type: "array",
					items: { type: "string" },
					description: "指定角色列表（可选，默认使用全链）",
				},
				mode: {
					type: "string",
					enum: ["solo", "chain", "team"],
					description: "执行模式（可选，默认自动推断）",
				},
				style: {
					type: "string",
					description: "执行风格（可选，默认 pragmatist）",
				},
				plan: {
					type: "object",
					description: "已有执行计划（run 可选，跳过推断）",
				},
				workerId: {
					type: "string",
					description: "Worker ID（status 必填）",
				},
			},
			required: ["action"],
			additionalProperties: false,
		} as const,
		execute: wrap(handleDteamAction),
		renderResult: makeTextRenderer((p) => {
			const a = p?.action;
			if (a === "list") return `✓ ${p?.count ?? 0} agents`;
			if (a === "plan") return `✓ Plan: ${p?.chainPlan?.steps?.length ?? 0} steps`;
			if (a === "run") return `✓ Worker ${p?.workerId ?? "?"} started`;
			if (a === "status") return `📊 Worker ${p?.workerId ?? "?"}: ${p?.status ?? "?"}`;
			return `✓ dteam ${a ?? "?"}`;
		}),
	});

	pi.registerCommand("dteam", {
		description: "Toggle worker progress panel (multi-worker Tab) — or use dteam tool for list/plan/run/status",
		async handler(_args: string, ctx) {
			// 展开/折叠多 worker Tab 面板
			showWorkerPanel(ctx);
		},
	});
}

// ── 工具输出渲染辅助函数（项目内，不导出） ────────────────────

/** 提取 result.content[0].text */
function getResultText(result: { content?: Array<{ type: string; text?: string }> }): string {
	if (!Array.isArray(result.content)) return "";
	const first = result.content[0];
	if (first?.type === "text" && typeof first.text === "string") return first.text;
	return "";
}

/** 错误摘要：parsed.error 字符串或 null */
function getErrorSummary(parsed: any): string | null {
	if (parsed && typeof parsed === "object" && typeof parsed.error === "string") return parsed.error;
	return null;
}

/** JSON 美化：失败回原样 */
function beautifyJson(raw: string): string {
	try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

/** 行数截断：超过 max 行则截断并加 "... (N more lines)" */
function expandLines(text: string, max: number): string {
	if (!text) return "";
	const lines = text.split("\n");
	if (lines.length <= max) return text;
	return lines.slice(0, max).join("\n") + `\n… (${lines.length - max} more lines)`;
}

/** 展开态提示文本（折叠态用） */
function expandHint(theme: any): string {
	return theme.fg("dim", ` (${keyHint("app.tools.expand", "to expand")})`);
}

/**
 * Text 渲染器：默认一行 + 展开后美化 JSON。适用 25 个返回 JSON 的工具。
 */
function makeTextRenderer(summaryFn: (parsed: any) => string) {
	return (
		result: { content: Array<{ type: string; text?: string }> },
		options: { expanded: boolean; isPartial: boolean },
		theme: any,
	) => {
		if (options.isPartial) {
			return new Text(theme.fg("warning", "⏳ Processing…"), 0, 0);
		}
		const text = getResultText(result);
		let parsed: any = null;
		try { parsed = JSON.parse(text); } catch {}
		const err = getErrorSummary(parsed);
		if (err) {
			return new Text(theme.fg("error", `✗ ${err}`) + (options.expanded ? "" : expandHint(theme)), 0, 0);
		}
		let line = theme.fg("success", summaryFn(parsed));
		if (!options.expanded) line += expandHint(theme);
		if (options.expanded) {
			const body = expandLines(beautifyJson(text), 30);
			for (const l of body.split("\n")) line += "\n" + theme.fg("dim", l);
		}
		return new Text(line, 0, 0);
	};
}

/**
 * Markdown 渲染器：展开后用 Markdown 渲染 .md 内容。适用 task_read / reference_architecture。
 */
function makeMarkdownRenderer(summaryFn: (parsed: any) => string) {
	return (
		result: { content: Array<{ type: string; text?: string }> },
		options: { expanded: boolean; isPartial: boolean },
		theme: any,
	) => {
		if (options.isPartial) {
			return new Text(theme.fg("warning", "⏳ Processing…"), 0, 0);
		}
		const text = getResultText(result);
		let parsed: any = null;
		try { parsed = JSON.parse(text); } catch {}
		const err = getErrorSummary(parsed);
		if (err) {
			return new Text(theme.fg("error", `✗ ${err}`) + (options.expanded ? "" : expandHint(theme)), 0, 0);
		}
		const summary = theme.fg("success", summaryFn(parsed));
		if (!options.expanded) return new Text(summary + expandHint(theme), 0, 0);
		// 展开：抽出 .md 文本（parsed.content / parsed.body / text）
		const md = (parsed && typeof parsed === "object"
			? (typeof parsed.content === "string" ? parsed.content
				: typeof parsed.body === "string" ? parsed.body
				: typeof parsed.text === "string" ? parsed.text : text)
			: text);
		const truncated = expandLines(md, 30);
		return new Markdown(truncated, 0, 0, getMarkdownTheme());
	};
}

/**
 * Worker 渲染器：默认显示 brief，展开显示 details.full 美化。适用 5 个 wrapWorker 工具。
 */
function makeWorkerRenderer() {
	return (
		result: { content: Array<{ type: string; text?: string }>; details?: { brief?: string; full?: unknown } },
		options: { expanded: boolean; isPartial: boolean },
		theme: any,
	) => {
		if (options.isPartial) {
			return new Text(theme.fg("warning", "⏳ Processing…"), 0, 0);
		}
		const text = getResultText(result);
		const details = result.details;
		const fullJson = details?.full;
		const err = getErrorSummary(fullJson);
		if (err) {
			return new Text(theme.fg("error", `✗ ${err}`) + (options.expanded ? "" : expandHint(theme)), 0, 0);
		}
		const brief = text;
		if (!options.expanded) return new Text(theme.fg("success", brief) + expandHint(theme), 0, 0);
		let line = theme.fg("success", brief);
		const fullStr = fullJson !== null && fullJson !== undefined ? JSON.stringify(fullJson, null, 2) : text;
		const body = expandLines(beautifyJson(fullStr), 30);
		for (const l of body.split("\n")) line += "\n" + theme.fg("dim", l);
		return new Text(line, 0, 0);
	};
}
