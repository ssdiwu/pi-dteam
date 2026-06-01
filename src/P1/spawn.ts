/**
 * P1-分子层：spawn 子代理运行
 *
 * 使用 Pi SDK createAgentSession 启动子 session 调真实 LLM。
 * 7 步模式（抄自 pi-dflow 的 src/core/spawn.ts，dteam 独立实现）：
 *   1. 准备 auth/registry
 *   2. 解析 model + fallback 链
 *   3. 构造 resourceLoader（注入 systemPrompt）
 *   4. 创建 session
 *   5. 订阅事件流（累加 text_delta / 收集 usage）
 *   6. 发 prompt
 *   7. 返回 result
 *
 * 字段对齐见 task 文档"dflow vs dteam SpawnOptions 接口 diff"表。
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	AuthStorage,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// ── 类型定义 ──────────────────────────────────────────────────

export interface SpawnOptions {
	systemPrompt: string;
	task: string;
	/** 模型字符串 "provider/id" 格式 */
	model?: string;
	/** Fallback 链，超过 5 个会被截断 */
	fallbackModels?: string[];
	/** 用户当前会话模型兜底 */
	sessionModel?: string;
	tools?: string[];
	signal?: AbortSignal;
	/** 流式回调，每次 text_delta 触发 */
	onUpdate?: (partial: { output: string }) => void;
	cwd?: string;
}

export interface SpawnUsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SpawnResult {
	exitCode: number;
	output: string;
	errorMessage?: string;
	model?: string;
	stopReason?: string;
	usage: SpawnUsageStats;
	/** 模型层错误标记（429/rate limit/auth/timeout 等） */
	isModelError?: boolean;
}

// ── 常量 ──────────────────────────────────────────────────

/** Fallback 链最大长度（对齐 task 风险表 #7 缓解措施） */
const MAX_FALLBACK_LENGTH = 5;

/** 错误分类正则（对齐 dflow MODEL_ERROR_PATTERNS） */
const MODEL_ERROR_PATTERNS = [
	/429/,
	/rate.?limit/i,
	/auth/i,
	/timeout/i,
	/model.?not.?found/i,
	/invalid.?api.?key/i,
	/quota.?exceeded/i,
	/overloaded/i,
];

const DEFAULT_USAGE: SpawnUsageStats = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
};

// ── 步骤 2：模型解析 ──────────────────────────────────────────────────

type ModelLookup = ReturnType<ModelRegistry["find"]>;

/** 解析 "provider/id" 格式的模型字符串 */
function resolveModel(
	modelStr: string,
	registry: ModelRegistry,
): ModelLookup {
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx > 0) {
		const provider = modelStr.slice(0, slashIdx);
		const id = modelStr.slice(slashIdx + 1);
		return registry.find(provider, id) ?? undefined;
	}
	// 无 provider 前缀，依次尝试常见 provider
	for (const provider of ["anthropic", "openai", "google"]) {
		const m = registry.find(provider, modelStr);
		if (m) return m;
	}
	return undefined;
}

/**
 * 走 fallback 链解析 model。
 * 返回 { resolved, used }：used 是实际使用的 model 字符串。
 */
function resolveModelWithFallback(
	primary: string,
	fallbacks: string[],
	registry: ModelRegistry,
): { resolved: ModelLookup; used: string } {
	const m = resolveModel(primary, registry);
	if (m) return { resolved: m, used: primary };

	for (const fb of fallbacks) {
		const fm = resolveModel(fb, registry);
		if (fm) return { resolved: fm, used: fb };
	}

	return { resolved: undefined, used: primary };
}

/** 截断 fallback 链到最大长度，warn 提示（对齐 task #7 缓解） */
function truncateFallbacks(fallbacks: string[]): string[] {
	if (fallbacks.length > MAX_FALLBACK_LENGTH) {
		console.warn(
			`[dteam.spawn] fallbackModels truncated to ${MAX_FALLBACK_LENGTH}`,
		);
		return fallbacks.slice(0, MAX_FALLBACK_LENGTH);
	}
	return fallbacks;
}

// ── 步骤 3：构造 resourceLoader ──────────────────────────────────────────────────

function buildResourceLoader(
	systemPrompt: string,
	cwd: string,
): DefaultResourceLoader {
	return new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		systemPromptOverride: () => systemPrompt,
	});
}

// ── 步骤 4+5：创建 session 并订阅事件 ──────────────────────────────────────────────────

interface StreamState {
	accumulatedText: string;
	usage: SpawnUsageStats;
	stopReason?: string;
	errorMessage?: string;
}

/** 订阅 session 事件流，累加 text、收集 usage、收集错误。返回闭包式 state。 */
function subscribeEventsWithState(
	session: AgentSession,
	onUpdate?: (partial: { output: string }) => void,
): StreamState {
	const state: StreamState = {
		accumulatedText: "",
		usage: { ...DEFAULT_USAGE },
	};

	session.subscribe((event: AgentSessionEvent) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			state.accumulatedText += event.assistantMessageEvent.delta;
			const out = state.accumulatedText || "(running...)";
			onUpdate?.({ output: out });
		}

		if (event.type === "turn_end") {
			state.usage.turns++;
			const msg = event.message as { usage?: any; model?: string };
			if (msg?.usage) {
				state.usage.input += msg.usage.input || 0;
				state.usage.output += msg.usage.output || 0;
				state.usage.cacheRead += msg.usage.cacheRead || 0;
				state.usage.cacheWrite += msg.usage.cacheWrite || 0;
				state.usage.cost += msg.usage.cost?.total || 0;
				state.usage.contextTokens = msg.usage.totalTokens || 0;
			}
		}

		if (event.type === "message_end") {
			const msg = (event as { message?: { role: string; stopReason?: string; errorMessage?: string } }).message;
			if (msg?.stopReason) state.stopReason = msg.stopReason;
			if (msg?.errorMessage) state.errorMessage = msg.errorMessage;
		}
	});

	return state;
}

// ── 错误分类 ──────────────────────────────────────────────────

function classifyModelError(errStr: string): boolean {
	return MODEL_ERROR_PATTERNS.some((p) => p.test(errStr));
}

// ── 步骤 6+7：发 prompt + 返回 result ──────────────────────────────────────────────────

/**
 * 创建子代理并执行任务。
 * 完整 7 步流程，详见文件头注释。
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
	const result: SpawnResult = {
		exitCode: 0,
		output: "",
		usage: { ...DEFAULT_USAGE },
	};

	let session: AgentSession | null = null;
	const cwd = options.cwd ?? process.cwd();

	// 步骤 1：准备 auth + registry（AuthStorage 失败 → isModelError=true，不走 fallback）
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	try {
		authStorage = AuthStorage.create();
		modelRegistry = ModelRegistry.create(authStorage);
	} catch (e) {
		const err = e as { name?: string; message?: string };
		const msg = err?.name ? `${err.name}: ${err.message ?? String(e)}` : String(e);
		result.exitCode = 1;
		result.isModelError = true;
		result.errorMessage = `[dteam.spawn] AuthStorage/ModelRegistry 初始化失败: ${msg}`;
		result.usage = { ...DEFAULT_USAGE };
		return result;
	}

	// 步骤 2：解析 model + 走 fallback 链
	if (!options.model && !options.sessionModel) {
		result.exitCode = 1;
		result.isModelError = true;
		result.errorMessage = "[dteam.spawn] 缺少 model 和 sessionModel 至少一个";
		result.usage = { ...DEFAULT_USAGE };
		return result;
	}

	const truncatedFallbacks = truncateFallbacks(options.fallbackModels ?? []);
	const allFallbacks = [
		...truncatedFallbacks,
		...(options.sessionModel ? [options.sessionModel] : []),
	];
	const primaryModel = options.model ?? options.sessionModel!;
	const { resolved: model, used: actualModel } = resolveModelWithFallback(
		primaryModel,
		allFallbacks,
		modelRegistry,
	);
	if (!model) {
		result.exitCode = 1;
		result.isModelError = true;
		result.errorMessage = `[dteam.spawn] Model not found: ${primaryModel}${allFallbacks.length ? ` (fallbacks: ${allFallbacks.join(", ")})` : ""}`;
		result.usage = { ...DEFAULT_USAGE };
		return result;
	}
	result.model = actualModel;

	// 步骤 3+4：构造 resourceLoader + 创建 session
	let resourceLoader: DefaultResourceLoader;
	try {
		resourceLoader = buildResourceLoader(options.systemPrompt, cwd);
		await resourceLoader.reload();
	} catch (e) {
		const err = e as { name?: string; message?: string };
		const msg = err?.name ? `${err.name}: ${err.message ?? String(e)}` : String(e);
		result.exitCode = 1;
		result.isModelError = true;
		result.errorMessage = `[dteam.spawn] DefaultResourceLoader 构造失败: ${msg}`;
		result.usage = { ...DEFAULT_USAGE };
		return result;
	}

	const tools = options.tools && options.tools.length > 0
		? options.tools
		: ["read", "bash", "edit", "write"];

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: true, maxRetries: 3 },
	});

	try {
		const created = await createAgentSession({
			cwd,
			model,
			tools,
			sessionManager: SessionManager.inMemory(),
			resourceLoader,
			authStorage,
			modelRegistry,
			settingsManager,
		});
		session = created.session;
	} catch (e) {
		const err = e as { name?: string; message?: string };
		const msg = err?.name ? `${err.name}: ${err.message ?? String(e)}` : String(e);
		result.exitCode = 1;
		result.isModelError = true;
		result.errorMessage = `[dteam.spawn] createAgentSession 失败: ${msg}`;
		result.usage = { ...DEFAULT_USAGE };
		return result;
	}

	// 步骤 5：订阅事件流
	const state = subscribeEventsWithState(session, options.onUpdate);

	// 处理 AbortSignal
	let onAbort: (() => void) | undefined;
	if (options.signal) {
		if (options.signal.aborted) {
			await session.abort();
			result.exitCode = 1;
			result.errorMessage = "Aborted before start";
			result.stopReason = "aborted";
			try { session.dispose(); } catch { /* ignore */ }
			return result;
		}
		onAbort = () => session!.abort();
		options.signal.addEventListener("abort", onAbort, { once: true });
	}

	// 步骤 6：发 prompt
	try {
		await session.prompt(options.task);
	} catch (e) {
		const err = e as { name?: string; message?: string };
		const msg = err?.name ? `${err.name}: ${err.message ?? String(e)}` : String(e);
		result.exitCode = 1;
		result.errorMessage = `[dteam.spawn] session.prompt 异常: ${msg}`;
		result.isModelError = classifyModelError(msg);
		result.output = state.accumulatedText || result.output;
		result.usage = state.usage;
		result.model = actualModel;
		result.stopReason = state.stopReason;
		return result;
	} finally {
		if (options.signal && onAbort) {
			options.signal.removeEventListener("abort", onAbort);
		}
	}

	// 步骤 7：返回 result
	result.output = state.accumulatedText || result.output;
	result.usage = state.usage;
	result.stopReason = state.stopReason;
	result.errorMessage = state.errorMessage;
	result.exitCode =
		state.stopReason === "error" || state.stopReason === "aborted" ? 1 : 0;
	if (state.errorMessage && !result.isModelError) {
		result.isModelError = classifyModelError(state.errorMessage);
	}

	try { session.dispose(); } catch { /* ignore dispose errors */ }
	return result;
}
