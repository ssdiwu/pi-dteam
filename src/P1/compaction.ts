/**
 * P1-分子层：Compaction 本地化
 *
 * 整合 pi-compaction-i18n 的功能，让 compaction 和 branch summary 输出本地化语言
 * 支持 11 种语言，自动检测 locale
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	convertToLlm,
	serializeConversation,
	generateSummary,
} from "@earendil-works/pi-coding-agent";
import { detectLocale, languageForLocale, languageInstructionForLocale, type SupportedLanguage } from "../P0/i18n.js";

// ── 本地化标签 ──────────────────────────────────────────────

interface SectionLabels {
	goal: string;
	constraints: string;
	progress: string;
	done: string;
	inProgress: string;
	blocked: string;
	decisions: string;
	nextSteps: string;
	critical: string;
}

const SECTION_LABELS: Record<SupportedLanguage, SectionLabels> = {
	"zh-Hans": {
		goal: "目标",
		constraints: "约束与偏好",
		progress: "进展",
		done: "已完成",
		inProgress: "进行中",
		blocked: "阻塞项",
		decisions: "关键决策",
		nextSteps: "下一步",
		critical: "关键上下文",
	},
	"zh-Hant": {
		goal: "目標",
		constraints: "約束與偏好",
		progress: "進展",
		done: "已完成",
		inProgress: "進行中",
		blocked: "阻塞項",
		decisions: "關鍵決策",
		nextSteps: "下一步",
		critical: "關鍵上下文",
	},
	ja: {
		goal: "目標",
		constraints: "制約と好み",
		progress: "進捗",
		done: "完了",
		inProgress: "進行中",
		blocked: "ブロッカー",
		decisions: "主要な判断",
		nextSteps: "次のステップ",
		critical: "重要なコンテキスト",
	},
	ko: {
		goal: "목표",
		constraints: "제약 및 선호",
		progress: "진행 상황",
		done: "완료됨",
		inProgress: "진행 중",
		blocked: "차단 요소",
		decisions: "핵심 결정",
		nextSteps: "다음 단계",
		critical: "핵심 맥락",
	},
	de: {
		goal: "Ziel",
		constraints: "Einschränkungen & Präferenzen",
		progress: "Fortschritt",
		done: "Erledigt",
		inProgress: "In Arbeit",
		blocked: "Blockiert",
		decisions: "Wichtige Entscheidungen",
		nextSteps: "Nächste Schritte",
		critical: "Kritischer Kontext",
	},
	fr: {
		goal: "Objectif",
		constraints: "Contraintes & Préférences",
		progress: "Progression",
		done: "Terminé",
		inProgress: "En cours",
		blocked: "Bloqué",
		decisions: "Décisions clés",
		nextSteps: "Étapes suivantes",
		critical: "Contexte critique",
	},
	es: {
		goal: "Objetivo",
		constraints: "Restricciones y preferencias",
		progress: "Progreso",
		done: "Hecho",
		inProgress: "En progreso",
		blocked: "Bloqueado",
		decisions: "Decisiones clave",
		nextSteps: "Próximos pasos",
		critical: "Contexto crítico",
	},
	pt: {
		goal: "Objetivo",
		constraints: "Restrições e preferências",
		progress: "Progresso",
		done: "Concluído",
		inProgress: "Em andamento",
		blocked: "Bloqueado",
		decisions: "Decisões principais",
		nextSteps: "Próximos passos",
		critical: "Contexto crítico",
	},
	ru: {
		goal: "Цель",
		constraints: "Ограничения и предпочтения",
		progress: "Прогресс",
		done: "Сделано",
		inProgress: "В процессе",
		blocked: "Блокеры",
		decisions: "Ключевые решения",
		nextSteps: "Следующие шаги",
		critical: "Критический контекст",
	},
	ar: {
		goal: "الهدف",
		constraints: "القيود والتفضيلات",
		progress: "التقدم",
		done: "تم الإنجاز",
		inProgress: "قيد التنفيذ",
		blocked: "العوائق",
		decisions: "القرارات الرئيسية",
		nextSteps: "الخطوات التالية",
		critical: "السياق الحرج",
	},
	en: {
		goal: "Goal",
		constraints: "Constraints & Preferences",
		progress: "Progress",
		done: "Done",
		inProgress: "In Progress",
		blocked: "Blocked",
		decisions: "Key Decisions",
		nextSteps: "Next Steps",
		critical: "Critical Context",
	},
};

// ── 本地化模板 ──────────────────────────────────────────────

function localizedSummaryFormat(locale?: string): string {
	const lang = languageForLocale(locale);
	const l = SECTION_LABELS[lang];

	return `Use this EXACT markdown structure and localized headings:

## ${l.goal}
[Main objective(s) of the user]

## ${l.constraints}
- [Requirements, preferences, or constraints from the user]
- [Write "(none)" if there are none]

## ${l.progress}
### ${l.done}
- [x] [Completed work]

### ${l.inProgress}
- [ ] [Current ongoing work]

### ${l.blocked}
- [Current blockers]
- [Write "(none)" if there are none]

## ${l.decisions}
- **[Decision]**: [Short rationale]
- [Write "(none)" if there are none]

## ${l.nextSteps}
1. [Ordered next action]

## ${l.critical}
- [Important paths, identifiers, errors, references, or context needed to continue]
- [Write "(none)" if there are none]`;
}

function buildCompactionPrompt(args: {
	locale?: string;
	conversationText: string;
	previousSummary?: string;
	customInstructions?: string;
}): string {
	const { locale, conversationText, previousSummary, customInstructions } = args;
	const format = localizedSummaryFormat(locale);

	const lines = [
		`You are performing a context checkpoint compaction for pi.`,
		`Summarize the conversation so another LLM can continue the work without losing important context.`,
		`Preserve exact file paths, function names, identifiers, and error messages when relevant.`,
		previousSummary
			? `Merge the new conversation updates with the previous summary provided below. Preserve important older context while updating progress and next steps.`
			: `This is the first summary for this span of conversation.`,
		format,
	];

	if (customInstructions?.trim()) {
		lines.push(`Additional user instructions for this compaction: ${customInstructions.trim()}`);
	}

	let prompt = `${lines.join("\n\n")}\n\n<conversation>\n${conversationText}\n</conversation>`;
	if (previousSummary) {
		prompt += `\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`;
	}
	return prompt;
}

function buildTreeSummaryPrompt(args: {
	locale?: string;
	conversationText: string;
	customInstructions?: string;
}): string {
	const { locale, conversationText, customInstructions } = args;
	const format = localizedSummaryFormat(locale);

	const lines = [
		`You are summarizing a branch that the session is leaving during tree navigation in pi.`,
		`Create a concise but complete handoff summary so the user can return later without losing context.`,
		`Preserve exact file paths, function names, identifiers, and error messages when relevant.`,
		format,
	];

	if (customInstructions?.trim()) {
		lines.push(`Additional user instructions for this branch summary: ${customInstructions.trim()}`);
	}

	return `${lines.join("\n\n")}\n\n<branch-conversation>\n${conversationText}\n</branch-conversation>`;
}

// ── 辅助函数 ──────────────────────────────────────────────

function serializeAgentMessages(messages: any[]): string {
	return serializeConversation(convertToLlm(messages));
}

function entryToAgentMessage(entry: any): any | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	switch (entry.type) {
		case "message":
			return entry.message;
		case "custom_message":
			return {
				role: "custom",
				customType: entry.customType,
				content: entry.content,
				display: entry.display,
				details: entry.details,
				timestamp: new Date(entry.timestamp).getTime(),
			};
		case "branch_summary":
			return {
				role: "branchSummary",
				summary: entry.summary,
				fromId: entry.fromId,
				timestamp: new Date(entry.timestamp).getTime(),
			};
		case "compaction":
			return {
				role: "compactionSummary",
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: new Date(entry.timestamp).getTime(),
			};
		default:
			return undefined;
	}
}

function serializeSessionEntries(entries: any[]): string {
	const messages = entries.map(entryToAgentMessage).filter(Boolean);
	return serializeAgentMessages(messages);
}

// ── 注册事件处理器 ──────────────────────────────────────────────

export function registerCompactionI18n(pi: ExtensionAPI): void {
	pi.on("session_before_compact", async (event, ctx) => {
		try {
			if (!ctx.model) {
				return undefined;
			}

			const locale = detectLocale();
			const languageInstruction = languageInstructionForLocale(locale);

			const conversationText = serializeAgentMessages([
				...event.preparation.messagesToSummarize,
				...event.preparation.turnPrefixMessages,
			]);

			const prompt = `${languageInstruction}\n\n${buildCompactionPrompt({
				locale,
				conversationText,
				previousSummary: event.preparation.previousSummary,
				customInstructions: event.customInstructions,
			})}`;

			// 合并要总结的消息
			const messagesToSummarize = [
				...event.preparation.messagesToSummarize,
				...event.preparation.turnPrefixMessages,
			];

			const summary = await generateSummary(
				messagesToSummarize,
				ctx.model,
				event.preparation.settings.reserveTokens,
				undefined, // apiKey - 由 modelRegistry 处理
				undefined, // headers
				event.signal,
				prompt,
				event.preparation.previousSummary,
			);

			if (!summary) {
				return undefined;
			}

			return {
				compaction: {
					summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: {
						locale,
						languageInstruction,
						source: "dteam-compaction-i18n",
					},
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`dteam compaction i18n failed: ${message}`, "warning");
			return undefined;
		}
	});

	pi.on("session_before_tree", async (event, ctx) => {
		try {
			if (!event.preparation.userWantsSummary || !ctx.model) {
				return undefined;
			}

			const locale = detectLocale();
			const languageInstruction = languageInstructionForLocale(locale);
			const conversationText = serializeSessionEntries(event.preparation.entriesToSummarize ?? []);

			const prompt = `${languageInstruction}\n\n${buildTreeSummaryPrompt({
				locale,
				conversationText,
				customInstructions: event.preparation.customInstructions,
			})}`;

			// 从 entries 中提取消息
			const entriesToSummarize = event.preparation.entriesToSummarize ?? [];
			const agentMessages = entriesToSummarize
				.map((entry: any) => entryToAgentMessage(entry))
				.filter((msg: any) => msg !== undefined);

			const summary = await generateSummary(
				agentMessages,
				ctx.model,
				16384, // reserveTokens
				undefined, // apiKey
				undefined, // headers
				event.signal,
				prompt,
			);

			if (!summary) {
				return undefined;
			}

			return {
				summary: {
					summary,
					details: {
						locale,
						languageInstruction,
						source: "dteam-compaction-i18n",
					},
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`dteam tree summary i18n failed: ${message}`, "warning");
			return undefined;
		}
	});

	// 注册状态检查命令
	pi.registerCommand("compaction-i18n-status", {
		description: "显示 dteam compaction i18n 的 locale 检测状态",
		async handler(_args: string, ctx) {
			const locale = detectLocale();
			const language = languageForLocale(locale);
			const instruction = languageInstructionForLocale(locale);
			ctx.ui.notify(
				[
					`dteam compaction-i18n: enabled`,
					`Detected locale: ${locale ?? "(none)"}`,
					`Summary language: ${language}`,
					`Instruction: ${instruction}`,
				].join("\n"),
				"info",
			);
		},
	});
}
