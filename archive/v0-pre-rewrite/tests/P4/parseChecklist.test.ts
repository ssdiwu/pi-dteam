/**
 * parseChecklist 单测
 *
 * 覆盖：
 * - AC-9 A 层 + B 层
 * - AC-9 单层旧格式（全部视作 A 层）
 * - AC-9 空 section
 * - 文件不存在（容错）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChecklist } from "../../src/P4/parseChecklist.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "parseChecklist-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeTask(content: string): string {
	const p = join(tmpDir, "test-task.md");
	writeFileSync(p, content, "utf-8");
	return p;
}

describe("parseChecklist", () => {
	it("AC-9: A 层 + B 层双层结构", () => {
		const path = writeTask(`# 测试 task

## 目标
实现用户登录

## 范围
- 包含：登录表单

## 验收条件

### A. 可校验
- [ ] AC-1 工具只显示一行概要
- [ ] AC-2 错误态视觉区分

### B. 人工裁决
- [ ] 是否需要密码强度提示
- [ ] 是否支持第三方登录
`);

		const plan = parseChecklist(path);
		expect(plan.machine).toHaveLength(2);
		expect(plan.machine[0].acId).toBe("AC-1");
		expect(plan.machine[1].acId).toBe("AC-2");
		expect(plan.human).toHaveLength(2);
		expect(plan.human[0]).toContain("密码强度");
		expect(plan.goalSummary).toBe("实现用户登录");
	});

	it("AC-9: 单层旧格式（所有 checklist 视作 A 层）", () => {
		const path = writeTask(`## 验收条件
- [ ] AC-1 工具只显示一行概要
- [ ] AC-2 错误态视觉区分
- [ ] AC-3 流式态显示
`);

		const plan = parseChecklist(path);
		expect(plan.machine).toHaveLength(3);
		expect(plan.human).toHaveLength(0);
	});

	it("AC-9: 空 section 返回空数组", () => {
		const path = writeTask(`# 没有验收条件

## 目标
随便写写
`);

		const plan = parseChecklist(path);
		expect(plan.machine).toHaveLength(0);
		expect(plan.human).toHaveLength(0);
	});

	it("AC-9: 文件不存在时容错", () => {
		const plan = parseChecklist("/nonexistent/path.md");
		expect(plan.machine).toEqual([]);
		expect(plan.human).toEqual([]);
		expect(plan.goalSummary).toContain("无法读取");
	});

	it("AC-9: A 层无 acId 的行被过滤", () => {
		const path = writeTask(`## 验收条件
- [ ] AC-1 有效 acId
- [ ] 没有 acId 的奇怪行
- [ ] AC-2 另一个有效
`);

		const plan = parseChecklist(path);
		expect(plan.machine).toHaveLength(2);
		expect(plan.machine[0].acId).toBe("AC-1");
		expect(plan.machine[1].acId).toBe("AC-2");
	});

	it("AC-9: goal 截断到 50 字符", () => {
		const longGoal = "实现".padEnd(60, "x");
		const path = writeTask(`## 目标\n${longGoal}\n\n## 验收条件\n- [ ] AC-1 test`);

		const plan = parseChecklist(path);
		expect(plan.goalSummary.length).toBeLessThanOrEqual(50);
	});
});
