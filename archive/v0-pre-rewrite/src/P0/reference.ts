/**
 * reference 工具实现
 *
 * 2个工具：reference.architecture/reference.thinking
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── 常量 ──────────────────────────────────────────────────────

const REFERENCE_DIR = "reference";
const ARCHITECTURE_FILE = "architecture-types.toml";
const THINKING_FILE = "thinking-styles.toml";

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 读取 TOML 文件（简单的行解析）
 */
async function readTomlFile(filepath: string): Promise<Record<string, string>> {
	const content = await readFile(filepath, "utf-8");
	const result: Record<string, string> = {};

	let currentSection = "";
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#") || trimmed === "") {
			continue;
		}

		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			currentSection = trimmed.slice(1, -1);
			continue;
		}

		const equalIndex = trimmed.indexOf("=");
		if (equalIndex > 0) {
			const key = trimmed.slice(0, equalIndex).trim();
			const value = trimmed.slice(equalIndex + 1).trim().replace(/^["']|["']$/g, "");
			const fullKey = currentSection ? `${currentSection}.${key}` : key;
			result[fullKey] = value;
		}
	}

	return result;
}

/**
 * 搜索 TOML 数据
 */
function searchToml(data: Record<string, string>, query: string): Array<{ key: string; value: string }> {
	const results: Array<{ key: string; value: string }> = [];
	const lowerQuery = query.toLowerCase();

	for (const [key, value] of Object.entries(data)) {
		if (
			key.toLowerCase().includes(lowerQuery) ||
			value.toLowerCase().includes(lowerQuery)
		) {
			results.push({ key, value });
		}
	}

	return results;
}

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * reference.architecture — 查询架构类型参考
 */
export async function referenceArchitecture(
	ctx: { cwd: string },
	params: { query: string },
): Promise<{ content: string }> {
	const { query } = params;
	const filepath = join(ctx.cwd, REFERENCE_DIR, ARCHITECTURE_FILE);

	if (!existsSync(filepath)) {
		return {
			content: JSON.stringify({
				error: `Architecture types file not found: ${filepath}`,
			}),
		};
	}

	const data = await readTomlFile(filepath);
	const results = searchToml(data, query);

	return {
		content: JSON.stringify({
			query,
			results,
			message: `Found ${results.length} results for "${query}"`,
		}),
	};
}

/**
 * reference.thinking — 查询思考方式参考
 */
export async function referenceThinking(
	ctx: { cwd: string },
	params: { query: string },
): Promise<{ content: string }> {
	const { query } = params;
	const filepath = join(ctx.cwd, REFERENCE_DIR, THINKING_FILE);

	if (!existsSync(filepath)) {
		return {
			content: JSON.stringify({
				error: `Thinking styles file not found: ${filepath}`,
			}),
		};
	}

	const data = await readTomlFile(filepath);
	const results = searchToml(data, query);

	return {
		content: JSON.stringify({
			query,
			results,
			message: `Found ${results.length} results for "${query}"`,
		}),
	};
}
