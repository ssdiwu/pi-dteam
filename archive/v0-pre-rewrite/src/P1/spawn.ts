/**
 * P1-分子层：spawn 子代理运行
 *
 * 使用 Pi SDK createAgentSession 启动子 session 调真实 LLM。
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
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

// ── 类型定义 ──────────────────────────────────────────────────

export interface AgentProgress {
	startTime: number;
	currentTool?: string;
	recentOutput: string;
	tokenCount: number;
	status: "running" | "tool" | "done" | "error" | "aborted";
}

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
	/** 流式回调，每次 text_delta 触发；progress 为兼容扩展字段 */
	onUpdate?: (partial: { output: string; progress?: AgentProgress }) => void;
	cwd?: string;
	/** Tool 事件回调（用于 widget 更新等），progress 为兼容扩展字段 */
	onToolEvent?: (event: { type: "start" | "end"; toolName?: string; progress?: AgentProgress }) => void;
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

const MAX_FALLBACK_LENGTH = 5;
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

const MODEL_ERROR_PATTERNS = [
	/429/,
	/rate.?limit/i,
	/\b(?:un)?authorized\b|\bauthentication\b|\bauthorization\b/i,
	/timeout/i,
	/model.?not.?found/i,
	/invalid.?api.?key/i,
	/quota.?exceeded/i,
	/overloaded/i,
];

const MODEL_PARSE_PATTERNS: Array<[RegExp, string]> = [
	[/^(claude-.+)$/i, "anthropic/$1"],
	[/^(claude_.+)$/i, "anthropic/$1"],
	[/^anthropic:(.+)$/i, "anthropic/$1"],
	[/^(gpt-.+)$/i, "openai/$1"],
	[/^(o[134](?:-.+)?)$/i, "openai/$1"],
	[/^(chatgpt-.+)$/i, "openai/$1"],
	[/^openai[.:](.+)$/i, "openai/$1"],
	[/^(gemini-.+)$/i, "google/$1"],
	[/^google[.:](.+)$/i, "google/$1"],
	[/^(models\/gemini-.+)$/i, "google/$1"],
	[/^bedrock[.:](.+)$/i, "bedrock/$1"],
	[/^(anthropic\.claude-.+)$/i, "bedrock/$1"],
	[/^(amazon\..+)$/i, "bedrock/$1"],
	[/^vertex[.:](.+)$/i, "vertex/$1"],
	[/^(publishers\/google\/models\/.+)$/i, "vertex/$1"],
	[/^azure[.:](.+)$/i, "azure/$1"],
	[/^azure-openai[.:](.+)$/i, "azure/$1"],
	[/^openrouter[.:](.+)$/i, "openrouter/$1"],
	[/^(mistral-.+)$/i, "mistral/$1"],
	[/^(open-mistral-.+)$/i, "mistral/$1"],
	[/^(codestral-.+)$/i, "mistral/$1"],
	[/^(magistral-.+)$/i, "mistral/$1"],
	[/^(deepseek-.+)$/i, "deepseek/$1"],
	[/^deepseek[.:](.+)$/i, "deepseek/$1"],
	[/^(grok-.+)$/i, "grok/$1"],
	[/^xai[.:](.+)$/i, "grok/$1"],
	[/^(sonar(?:-.+)?)$/i, "perplexity/$1"],
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

// ── 模型解析 ──────────────────────────────────────────────────

type ModelLookup = ReturnType<ModelRegistry["find"]>;

function findProviderModel(modelStr: string, registry: ModelRegistry): ModelLookup {
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx <= 0) return undefined;
	return registry.find(modelStr.slice(0, slashIdx), modelStr.slice(slashIdx + 1)) ?? undefined;
}

function parseModelAlias(modelStr: string): string | undefined {
	for (const [pattern, replacement] of MODEL_PARSE_PATTERNS) {
		if (pattern.test(modelStr)) return modelStr.replace(pattern, replacement);
	}
	return undefined;
}

function resolveModel(modelStr: string, registry: ModelRegistry): ModelLookup {
	if (modelStr.includes("/")) return findProviderModel(modelStr, registry);
	const normalized = parseModelAlias(modelStr);
	if (normalized && normalized !== modelStr) {
		const mapped = findProviderModel(normalized, registry);
		if (mapped) return mapped;
	}
	for (const provider of ["anthropic", "openai", "google"]) {
		const m = registry.find(provider, modelStr);
		if (m) return m;
	}
	return undefined;
}

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

function truncateFallbacks(fallbacks: string[]): string[] {
	if (fallbacks.length <= MAX_FALLBACK_LENGTH) return fallbacks;
	console.warn(`[dteam.spawn] fallbackModels truncated to ${MAX_FALLBACK_LENGTH}`);
	return fallbacks.slice(0, MAX_FALLBACK_LENGTH);
}

// ── 资源与事件流 ────────────────────────────────────────────────

interface StreamState {
	accumulatedText: string;
	usage: SpawnUsageStats;
	progress: AgentProgress;
	stopReason?: string;
	errorMessage?: string;
}

function buildResourceLoader(systemPrompt: string, cwd: string): DefaultResourceLoader {
	return new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		systemPromptOverride: () => systemPrompt,
	});
}

function createStreamAccumulator(): StreamState {
	return {
		accumulatedText: "",
		usage: { ...DEFAULT_USAGE },
		progress: { startTime: Date.now(), recentOutput: "", tokenCount: 0, status: "running" },
	};
}

function emitProgress(state: StreamState, onUpdate?: SpawnOptions["onUpdate"]): void {
	onUpdate?.({ output: state.accumulatedText || "(running...)", progress: { ...state.progress } });
}

function wireEventHandlers(
	session: AgentSession,
	state: StreamState,
	onUpdate?: SpawnOptions["onUpdate"],
	onToolEvent?: SpawnOptions["onToolEvent"],
): void {
	session.subscribe((event: AgentSessionEvent) => {
		handleTextEvent(event, state, onUpdate);
		handleToolEvent(event, state, onToolEvent);
		handleTurnEnd(event, state, onUpdate);
		handleMessageEnd(event, state, onUpdate);
	});
}

function handleTextEvent(event: AgentSessionEvent, state: StreamState, onUpdate?: SpawnOptions["onUpdate"]): void {
	const msg = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
	if (event.type !== "message_update" || msg?.type !== "text_delta") return;
	state.accumulatedText += msg.delta ?? "";
	state.progress.recentOutput = state.accumulatedText.slice(-500);
	state.progress.status = "running";
	emitProgress(state, onUpdate);
}

function handleToolEvent(event: AgentSessionEvent, state: StreamState, onToolEvent?: SpawnOptions["onToolEvent"]): void {
	if (event.type === "tool_execution_start") {
		const toolName = (event as { toolName?: string }).toolName;
		state.progress.currentTool = toolName;
		state.progress.status = "tool";
		onToolEvent?.({ type: "start", toolName, progress: { ...state.progress } });
	}
	if (event.type === "tool_execution_end") {
		state.progress.currentTool = undefined;
		state.progress.status = "running";
		onToolEvent?.({ type: "end", progress: { ...state.progress } });
	}
}

function handleTurnEnd(event: AgentSessionEvent, state: StreamState, onUpdate?: SpawnOptions["onUpdate"]): void {
	if (event.type !== "turn_end") return;
	state.usage.turns++;
	const usage = (event.message as { usage?: any })?.usage;
	if (!usage) return;
	state.usage.input += usage.input || 0;
	state.usage.output += usage.output || 0;
	state.usage.cacheRead += usage.cacheRead || 0;
	state.usage.cacheWrite += usage.cacheWrite || 0;
	state.usage.cost += usage.cost?.total || 0;
	state.usage.contextTokens = usage.totalTokens || 0;
	state.progress.tokenCount = state.usage.contextTokens;
	emitProgress(state, onUpdate);
}

function handleMessageEnd(event: AgentSessionEvent, state: StreamState, onUpdate?: SpawnOptions["onUpdate"]): void {
	if (event.type !== "message_end") return;
	const msg = (event as { message?: { stopReason?: string; errorMessage?: string } }).message;
	if (msg?.stopReason) state.stopReason = msg.stopReason;
	if (msg?.errorMessage) state.errorMessage = msg.errorMessage;
	state.progress.status = msg?.errorMessage ? "error" : msg?.stopReason === "aborted" ? "aborted" : "done";
	emitProgress(state, onUpdate);
}

// ── 错误与产物 ──────────────────────────────────────────────────

function classifyModelError(errStr: string): boolean {
	return MODEL_ERROR_PATTERNS.some((p) => p.test(errStr));
}

function formatError(e: unknown): string {
	const err = e as { name?: string; message?: string };
	return err?.name ? `${err.name}: ${err.message ?? String(e)}` : String(e);
}

function setError(result: SpawnResult, e: unknown, prefix: string, isModelError: boolean): SpawnResult {
	result.exitCode = 1;
	result.isModelError = isModelError;
	result.errorMessage = `[dteam.spawn] ${prefix}: ${formatError(e)}`;
	return result;
}

interface SpawnArtifacts {
	dir: string;
}

async function initSpawnArtifacts(options: SpawnOptions, cwd: string): Promise<SpawnArtifacts | undefined> {
	if (!options.cwd) return undefined;
	const dir = join(cwd, ".dteam", "spawn", `spawn-${Date.now()}-${randomBytes(3).toString("hex")}`);
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "input.md"), renderInputArtifact(options), "utf-8");
		return { dir };
	} catch (e) {
		console.warn(`[dteam.spawn] artifact init failed: ${formatError(e)}`);
		return undefined;
	}
}

function renderInputArtifact(options: SpawnOptions): string {
	return [`# spawn.input`, ``, `## model`, options.model ?? "", ``, `## task`, options.task, ``, `## systemPrompt`, options.systemPrompt].join("\n");
}

async function finalizeArtifacts(artifacts: SpawnArtifacts | undefined, result: SpawnResult): Promise<void> {
	if (!artifacts) return;
	const file = result.exitCode === 0 && !result.errorMessage ? "output.md" : "error.md";
	const body = file === "output.md" ? result.output : `${result.errorMessage ?? ""}\n\n${result.output}`;
	try {
		await writeFile(join(artifacts.dir, file), body || "(empty)", "utf-8");
	} catch (e) {
		console.warn(`[dteam.spawn] artifact finalize failed: ${formatError(e)}`);
	}
}

// ── 7 步执行 ──────────────────────────────────────────────────

interface RegistryState {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
}

interface ModelState {
	model: NonNullable<ModelLookup>;
	actualModel: string;
}

function createResult(): SpawnResult {
	return { exitCode: 0, output: "", usage: { ...DEFAULT_USAGE } };
}

function step1InitRegistry(result: SpawnResult): RegistryState | undefined {
	try {
		const authStorage = AuthStorage.create();
		return { authStorage, modelRegistry: ModelRegistry.create(authStorage) };
	} catch (e) {
		setError(result, e, "AuthStorage/ModelRegistry 初始化失败", true);
		return undefined;
	}
}

function step2ResolveModel(options: SpawnOptions, registry: ModelRegistry, result: SpawnResult): ModelState | undefined {
	if (!options.model && !options.sessionModel) {
		setError(result, "缺少 model 和 sessionModel 至少一个", "配置错误", true);
		return undefined;
	}
	const fallbacks = [...truncateFallbacks(options.fallbackModels ?? []), ...(options.sessionModel ? [options.sessionModel] : [])];
	const primary = options.model ?? options.sessionModel!;
	const { resolved, used } = resolveModelWithFallback(primary, fallbacks, registry);
	if (resolved) return { model: resolved, actualModel: used };
	setError(result, `Model not found: ${primary}${fallbacks.length ? ` (fallbacks: ${fallbacks.join(", ")})` : ""}`, "模型解析失败", true);
	return undefined;
}

async function step3LoadResource(options: SpawnOptions, cwd: string, result: SpawnResult): Promise<DefaultResourceLoader | undefined> {
	try {
		const resourceLoader = buildResourceLoader(options.systemPrompt, cwd);
		await resourceLoader.reload();
		return resourceLoader;
	} catch (e) {
		setError(result, e, "DefaultResourceLoader 构造失败", true);
		return undefined;
	}
}

async function step4CreateSession(args: {
	cwd: string; model: NonNullable<ModelLookup>; tools?: string[]; resourceLoader: DefaultResourceLoader;
	authStorage: AuthStorage; modelRegistry: ModelRegistry; result: SpawnResult;
}): Promise<AgentSession | undefined> {
	try {
		const created = await createAgentSession({
			cwd: args.cwd, model: args.model, tools: args.tools?.length ? args.tools : DEFAULT_TOOLS,
			sessionManager: SessionManager.inMemory(), resourceLoader: args.resourceLoader,
			authStorage: args.authStorage, modelRegistry: args.modelRegistry,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 3 } }),
		});
		return created.session;
	} catch (e) {
		setError(args.result, e, "createAgentSession 失败", true);
		return undefined;
	}
}

async function step5AttachAbort(session: AgentSession, signal: AbortSignal | undefined, result: SpawnResult): Promise<() => void> {
	if (!signal) return () => undefined;
	if (signal.aborted) {
		await session.abort();
		result.exitCode = 1;
		result.errorMessage = "Aborted before start";
		result.stopReason = "aborted";
		return () => undefined;
	}
	const onAbort = () => void session.abort();
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

async function step6Prompt(session: AgentSession, task: string, cleanup: () => void): Promise<unknown> {
	try {
		await session.prompt(task);
		return undefined;
	} catch (e) {
		return e;
	} finally {
		cleanup();
		try { session.dispose(); } catch { /* ignore dispose errors */ }
	}
}

function step7Finalize(result: SpawnResult, state: StreamState, promptError: unknown): void {
	if (promptError) {
		const msg = formatError(promptError);
		setError(result, promptError, "session.prompt 异常", classifyModelError(msg));
	}
	result.output = state.accumulatedText || result.output;
	result.usage = state.usage;
	result.stopReason = state.stopReason;
	result.errorMessage = result.errorMessage ?? state.errorMessage;
	if (state.errorMessage && !result.isModelError) result.isModelError = classifyModelError(state.errorMessage);
	if (state.errorMessage || state.stopReason === "error" || state.stopReason === "aborted") result.exitCode = 1;
}

async function finish(result: SpawnResult, artifacts?: SpawnArtifacts): Promise<SpawnResult> {
	await finalizeArtifacts(artifacts, result);
	return result;
}

/** 创建子代理并执行任务。 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
	const result = createResult();
	const cwd = options.cwd ?? process.cwd();
	const artifacts = await initSpawnArtifacts(options, cwd);
	const registry = step1InitRegistry(result);
	if (!registry) return finish(result, artifacts);
	const modelState = step2ResolveModel(options, registry.modelRegistry, result);
	if (!modelState) return finish(result, artifacts);
	result.model = modelState.actualModel;
	const resourceLoader = await step3LoadResource(options, cwd, result);
	if (!resourceLoader) return finish(result, artifacts);
	const session = await step4CreateSession({ cwd, model: modelState.model, tools: options.tools, resourceLoader, ...registry, result });
	if (!session) return finish(result, artifacts);
	const state = createStreamAccumulator();
	wireEventHandlers(session, state, options.onUpdate, options.onToolEvent);
	const cleanup = await step5AttachAbort(session, options.signal, result);
	if (result.stopReason === "aborted") {
		try { session.dispose(); } catch { /* ignore */ }
		return finish(result, artifacts);
	}
	step7Finalize(result, state, await step6Prompt(session, options.task, cleanup));
	return finish(result, artifacts);
}
