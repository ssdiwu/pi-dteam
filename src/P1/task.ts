/**
 * task 工具实现
 *
 * 7个工具：task_create/read/update/complete/archive/list/search
 */

import { readFile, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { assertInside, safeFilenamePart } from "./pathSafety.js";

// ── 常量 ──────────────────────────────────────────────────────

const TASK_DIR = ".dteam/task";
const ARCHIVE_DIR = ".dteam/archive";

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 生成 task id: YYYYMMDDHHMMSS-XXXX
 */
function generateId(): string {
	const now = new Date();
	const ts = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
		String(now.getHours()).padStart(2, "0"),
		String(now.getMinutes()).padStart(2, "0"),
		String(now.getSeconds()).padStart(2, "0"),
	].join("");

	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	const buf = randomBytes(4);
	let rand = "";
	for (let i = 0; i < 4; i++) {
		rand += chars[buf[i] % chars.length];
	}
	return `${ts}-${rand}`;
}

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
}

/**
 * 查找 task 文件
 */
async function findTaskFile(cwd: string, id: string): Promise<string> {
	if (!/^\d{14}-[a-z0-9]{4}$/.test(id)) {
		throw new Error(`Invalid task id: ${id}`);
	}

	const taskDir = resolve(cwd, TASK_DIR);
	if (!existsSync(taskDir)) {
		throw new Error(`Task directory not found: ${taskDir}`);
	}

	const files = await readdir(taskDir);
	const file = files.find((f) => f.endsWith(`-${id}.md`));
	if (!file) {
		throw new Error(`Task not found: ${id}`);
	}

	const filepath = resolve(taskDir, file);
	assertInside(taskDir, filepath);
	return filepath;
}

/**
 * 读取 task 文件
 */
async function readTaskFile(filepath: string): Promise<string> {
	return await readFile(filepath, "utf-8");
}

/**
 * 写入 task 文件
 */
async function writeTaskFile(filepath: string, content: string): Promise<void> {
	await writeFile(filepath, content, "utf-8");
}

/**
 * 解析 task 元数据
 */
function parseTaskMeta(content: string, filename: string): {
	id: string;
	name: string;
	type: string;
	status: string;
	created: string;
} {
	const idMatch = filename.match(/(\d{14}-[a-z0-9]{4})/);
	const id = idMatch ? idMatch[1] : filename;

	const nameMatch = content.match(/^# (.+)$/m);
	const name = nameMatch ? nameMatch[1] : filename.replace(/-\d{14}-[a-z0-9]{4}\.md$/, "");

	const typeMatch = content.match(/类型:\s*(\w+)/);
	const type = typeMatch ? typeMatch[1] : "unknown";

	const statusMatch = content.match(/状态:\s*(\w+)/);
	const status = statusMatch ? statusMatch[1] : "unknown";

	const createdMatch = content.match(/创建时间:\s*(.+)$/m);
	const created = createdMatch ? createdMatch[1] : "";

	return { id, name, type, status, created };
}

function isRequestedSection(title: string, section: string): boolean {
	return title === section || title.startsWith(`${section}（`) || title.startsWith(`${section}(`);
}

function findSectionRange(content: string, section: string): {
	headingStart: number;
	bodyStart: number;
	end: number;
} | null {
	const headingRegex = /^##\s+(.+)$/gm;
	let match: RegExpExecArray | null;
	let target: { headingStart: number; bodyStart: number } | null = null;

	while ((match = headingRegex.exec(content)) !== null) {
		if (target) {
			return { ...target, end: match.index };
		}

		const title = match[1].trim();
		if (isRequestedSection(title, section)) {
			target = {
				headingStart: match.index,
				bodyStart: headingRegex.lastIndex,
			};
		}
	}

	return target ? { ...target, end: content.length } : null;
}

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * task_create — 创建新的 task
 */
export async function taskCreate(
	ctx: { cwd: string },
	params: { name: string; type: string; why: string; goal: string },
): Promise<{ content: string }> {
	const { name, type, why, goal } = params;
	const id = generateId();
	const timestamp = new Date().toISOString();
	const safeName = safeFilenamePart(name, "task");
	const filename = `${safeName}-${id}.md`;
	const taskDir = resolve(ctx.cwd, TASK_DIR);
	const filepath = resolve(taskDir, filename);
	assertInside(taskDir, filepath);

	// 确保目录存在
	await ensureDir(taskDir);

	// 构建 task 内容
	const content = `# ${name}

## 基本信息
- ID: ${id}
- 类型: ${type}
- 创建时间: ${timestamp}
- 状态: todo

## 目标
- 为什么: ${why}
- 做什么: ${goal}

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）
- [ ] 

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
`;

	// 写入文件
	await writeTaskFile(filepath, content);

	return {
		content: JSON.stringify({
			id,
			filename,
			path: filepath,
			message: `Task created: ${name}`,
		}),
	};
}

/**
 * task.read — 读取 task 的指定 section
 */
export async function taskRead(
	ctx: { cwd: string },
	params: { id: string; section: string },
): Promise<{ content: string }> {
	const { id, section } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const content = await readTaskFile(filepath);

	// 提取指定 section
	const range = findSectionRange(content, section);

	if (!range) {
		return {
			content: JSON.stringify({
				error: `Section not found: ${section}`,
			}),
		};
	}

	return {
		content: JSON.stringify({
			id,
			section,
			content: content.slice(range.bodyStart, range.end).trim(),
		}),
	};
}

/**
 * task.update — 更新 task 的指定 section
 */
export async function taskUpdate(
	ctx: { cwd: string },
	params: { id: string; section: string; content: string },
): Promise<{ content: string }> {
	const { id, section, content: newContent } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const existingContent = await readTaskFile(filepath);

	// 替换指定 section
	const range = findSectionRange(existingContent, section);
	if (!range) {
		return {
			content: JSON.stringify({
				error: `Section not found: ${section}`,
			}),
		};
	}

	const updatedContent = `${existingContent.slice(0, range.bodyStart)}${newContent}\n\n${existingContent.slice(range.end).replace(/^\n+/, "")}`;

	// 写入文件
	await writeTaskFile(filepath, updatedContent);

	return {
		content: JSON.stringify({
			id,
			section,
			message: `Section updated: ${section}`,
		}),
	};
}

/**
 * task.complete — 标记 checklist 项为完成
 */
export async function taskComplete(
	ctx: { cwd: string },
	params: { id: string; item: string },
): Promise<{ content: string }> {
	const { id, item } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const content = await readTaskFile(filepath);

	// 标记 checklist 项为完成
	const updatedContent = content.replace(
		`- [ ] ${item}`,
		`- [x] ${item}`,
	);

	if (updatedContent === content) {
		return {
			content: JSON.stringify({
				id,
				item,
				error: `Checklist item not found: ${item}`,
			}),
		};
	}

	// 写入文件
	await writeTaskFile(filepath, updatedContent);

	return {
		content: JSON.stringify({
			id,
			item,
			message: `Checklist item completed: ${item}`,
		}),
	};
}

/**
 * task.archive — 归档完成的任务
 */
export async function taskArchive(
	ctx: { cwd: string },
	params: { id: string },
): Promise<{ content: string }> {
	const { id } = params;
	const sourcePath = await findTaskFile(ctx.cwd, id);
	const filename = sourcePath.split("/").pop() || sourcePath.split("\\").pop();
	const destPath = join(ctx.cwd, ARCHIVE_DIR, filename || "");

	// 确保归档目录存在
	await ensureDir(join(ctx.cwd, ARCHIVE_DIR));

	// 移动文件
	await rename(sourcePath, destPath);

	return {
		content: JSON.stringify({
			id,
			sourcePath,
			destPath,
			message: `Task archived: ${id}`,
		}),
	};
}

/**
 * task.list — 列出所有 task
 */
export async function taskList(
	ctx: { cwd: string },
	params: { status?: string },
): Promise<{ content: string }> {
	const { status } = params;
	const taskDir = join(ctx.cwd, TASK_DIR);

	if (!existsSync(taskDir)) {
		return {
			content: JSON.stringify({
				tasks: [],
				message: "No tasks found",
			}),
		};
	}

	const files = await readdir(taskDir);
	const tasks: Array<{
		id: string;
		name: string;
		type: string;
		status: string;
		created: string;
	}> = [];

	for (const file of files) {
		if (!file.endsWith(".md")) continue;

		try {
			const filepath = join(taskDir, file);
			const content = await readTaskFile(filepath);
			const meta = parseTaskMeta(content, file);

			// 按状态过滤
			if (status && meta.status !== status) continue;

			tasks.push(meta);
		} catch {
			// 跳过无法解析的文件
		}
	}

	// 按创建时间排序（最新的在前）
	tasks.sort((a, b) => b.created.localeCompare(a.created));

	return {
		content: JSON.stringify({
			tasks,
			count: tasks.length,
			message: `Found ${tasks.length} tasks`,
		}),
	};
}

/**
 * task.search — 搜索 task
 */
export async function taskSearch(
	ctx: { cwd: string },
	params: { query: string },
): Promise<{ content: string }> {
	const { query } = params;
	const taskDir = join(ctx.cwd, TASK_DIR);

	if (!existsSync(taskDir)) {
		return {
			content: JSON.stringify({
				tasks: [],
				message: "No tasks found",
			}),
		};
	}

	const files = await readdir(taskDir);
	const tasks: Array<{
		id: string;
		name: string;
		type: string;
		status: string;
		created: string;
	}> = [];

	const lowerQuery = query.toLowerCase();

	for (const file of files) {
		if (!file.endsWith(".md")) continue;

		try {
			const filepath = join(taskDir, file);
			const content = await readTaskFile(filepath);
			const meta = parseTaskMeta(content, file);

			// 搜索匹配
			if (
				meta.name.toLowerCase().includes(lowerQuery) ||
				meta.type.toLowerCase().includes(lowerQuery) ||
				content.toLowerCase().includes(lowerQuery)
			) {
				tasks.push(meta);
			}
		} catch {
			// 跳过无法解析的文件
		}
	}

	// 按创建时间排序（最新的在前）
	tasks.sort((a, b) => b.created.localeCompare(a.created));

	return {
		content: JSON.stringify({
			tasks,
			count: tasks.length,
			message: `Found ${tasks.length} tasks matching "${query}"`,
		}),
	};
}
