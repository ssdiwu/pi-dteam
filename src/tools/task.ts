/**
 * task 工具实现
 *
 * 5个工具：task.create/read/update/complete/archive
 */

import { readFile, mkdir, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

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
 * 查找 task 文件
 */
async function findTaskFile(cwd: string, id: string): Promise<string> {
	const taskDir = join(cwd, TASK_DIR);
	if (!existsSync(taskDir)) {
		throw new Error(`Task directory not found: ${taskDir}`);
	}

	const files = await readdir(taskDir);
	const file = files.find((f) => f.includes(id));
	if (!file) {
		throw new Error(`Task not found: ${id}`);
	}

	return join(taskDir, file);
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
	const { writeFile } = await import("node:fs/promises");
	await writeFile(filepath, content, "utf-8");
}

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * task.create — 创建新的 task
 */
export async function taskCreate(
	_toolCallId: string,
	params: { name: string; type: string; why: string; goal: string },
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: { cwd: string },
): Promise<{ content: string }> {
	const { name, type, why, goal } = params;
	const id = generateId();
	const timestamp = new Date().toISOString();
	const filename = `${name}-${id}.md`;
	const filepath = join(ctx.cwd, TASK_DIR, filename);

	// 确保目录存在
	const taskDir = join(ctx.cwd, TASK_DIR);
	if (!existsSync(taskDir)) {
		await mkdir(taskDir, { recursive: true });
	}

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
	_toolCallId: string,
	params: { id: string; section: string },
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: { cwd: string },
): Promise<{ content: string }> {
	const { id, section } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const content = await readTaskFile(filepath);

	// 提取指定 section
	const sectionRegex = new RegExp(`## ${section}\\n([\\s\\S]*?)(?=## |$)`, "i");
	const match = content.match(sectionRegex);

	if (!match) {
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
			content: match[1].trim(),
		}),
	};
}

/**
 * task.update — 更新 task 的指定 section
 */
export async function taskUpdate(
	_toolCallId: string,
	params: { id: string; section: string; content: string },
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: { cwd: string },
): Promise<{ content: string }> {
	const { id, section, content: newContent } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const existingContent = await readTaskFile(filepath);

	// 替换指定 section
	const sectionRegex = new RegExp(`(## ${section}\\n)([\\s\\S]*?)(?=## |$)`, "i");
	const updatedContent = existingContent.replace(sectionRegex, `$1${newContent}\n\n`);

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
	_toolCallId: string,
	params: { id: string; item: string },
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: { cwd: string },
): Promise<{ content: string }> {
	const { id, item } = params;
	const filepath = await findTaskFile(ctx.cwd, id);
	const content = await readTaskFile(filepath);

	// 标记 checklist 项为完成
	const updatedContent = content.replace(
		`- [ ] ${item}`,
		`- [x] ${item}`,
	);

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
	_toolCallId: string,
	params: { id: string },
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: { cwd: string },
): Promise<{ content: string }> {
	const { id } = params;
	const sourcePath = await findTaskFile(ctx.cwd, id);
	const filename = sourcePath.split("/").pop() || sourcePath.split("\\").pop();
	const destPath = join(ctx.cwd, ARCHIVE_DIR, filename || "");

	// 确保归档目录存在
	const archiveDir = join(ctx.cwd, ARCHIVE_DIR);
	if (!existsSync(archiveDir)) {
		await mkdir(archiveDir, { recursive: true });
	}

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
