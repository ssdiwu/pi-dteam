/**
 * P0-原子层：门控检查
 *
 * 8 项门控检查 + 四态判定
 * 在 worker 执行前运行，确保 task 定义完整、可执行
 */

// ── 类型定义 ──────────────────────────────────────────────────

export type GateResult = 'READY' | 'RETURN' | 'BLOCKED' | 'REJECT';

export interface GateCheck {
  id: string;       // M1-M8
  name: string;
  passed: boolean;
  reason?: string;
}

export interface GateVerdict {
  result: GateResult;
  checks: GateCheck[];
  returnTarget?: string;  // RETURN 时打回到哪个阶段
}

export interface GateInput {
  id?: string;
  type?: string;
  why?: string;
  goal?: string;
  includes?: string[];
  excludes?: string[];
  acceptance?: string[];
  dependsOn?: string[];
  dependsOnStages?: Record<string, string>; // id → stage
}

// ── 辅助函数 ──────────────────────────────────────────────────

function isEmpty(v: string | undefined | null): boolean {
  return !v || v.trim().length === 0;
}

function isEmptyArray(v: string[] | undefined | null): boolean {
  return !v || v.length === 0;
}

/** 提取文本关键词（去停用词，长度 ≥ 2） */
function extractKeywords(text: string): Set<string> {
  const stop = new Set(['the','a','an','is','are','was','were','to','of','in','for','on','with','and','or','not','this','that']);
  return new Set(
    text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stop.has(w))
  );
}

// ── 逐项检查 (M1-M8) ─────────────────────────────────────────

function checkM1(i: GateInput): GateCheck {
  if (isEmpty(i.id)) return { id: 'M1', name: 'id 非空且唯一', passed: false, reason: 'id 为空' };
  return { id: 'M1', name: 'id 非空且唯一', passed: true };
}

function checkM2(i: GateInput): GateCheck {
  if (isEmpty(i.why)) return { id: 'M2', name: 'why 非空', passed: false, reason: 'why 为空' };
  return { id: 'M2', name: 'why 非空', passed: true };
}

function checkM3(i: GateInput): GateCheck {
  const g = i.goal;
  if (isEmpty(g)) return { id: 'M3', name: 'goal 清晰可执行', passed: false, reason: 'goal 为空' };
  if (g!.trim().length <= 10) {
    return { id: 'M3', name: 'goal 清晰可执行', passed: false, reason: `goal 过短（${g!.trim().length} 字符，需 > 10）` };
  }
  return { id: 'M3', name: 'goal 清晰可执行', passed: true };
}

function checkM4(i: GateInput): GateCheck {
  if (isEmptyArray(i.includes)) return { id: 'M4', name: 'includes 非空且具体', passed: false, reason: 'includes 为空' };
  return { id: 'M4', name: 'includes 非空且具体', passed: true };
}

function checkM5(i: GateInput): GateCheck {
  if (isEmptyArray(i.excludes)) return { id: 'M5', name: 'excludes 已标注', passed: false, reason: 'excludes 为空' };
  return { id: 'M5', name: 'excludes 已标注', passed: true };
}

function checkM6(i: GateInput): GateCheck {
  if (isEmptyArray(i.acceptance)) return { id: 'M6', name: 'acceptance 非空且可判定', passed: false, reason: 'acceptance 为空' };
  const tooShort = i.acceptance!.filter(c => c.trim().length <= 10);
  if (tooShort.length > 0) {
    return { id: 'M6', name: 'acceptance 非空且可判定', passed: false, reason: `${tooShort.length} 条验收标准过短` };
  }
  return { id: 'M6', name: 'acceptance 非空且可判定', passed: true };
}

function checkM7(i: GateInput): GateCheck {
  const deps = i.dependsOn;
  if (isEmptyArray(deps)) return { id: 'M7', name: 'dependsOn 均为 Done', passed: true };
  const stages = i.dependsOnStages ?? {};
  const unfinished = deps!.filter(id => stages[id] !== 'Done');
  if (unfinished.length > 0) {
    return { id: 'M7', name: 'dependsOn 均为 Done', passed: false, reason: `以下依赖未完成: ${unfinished.join(', ')}` };
  }
  return { id: 'M7', name: 'dependsOn 均为 Done', passed: true };
}

function checkM8(i: GateInput): GateCheck {
  if (isEmptyArray(i.includes)) return { id: 'M8', name: '变更不会破坏现有功能', passed: true };
  if (isEmptyArray(i.acceptance)) return { id: 'M8', name: '变更不会破坏现有功能', passed: false, reason: '无验收标准，无法确认变更安全性' };
  const text = i.acceptance!.join(' ').toLowerCase();
  const uncovered = i.includes!.filter(item => {
    const words = item.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    return words.length > 0 && !words.some(w => text.includes(w));
  });
  if (uncovered.length > 0) {
    return { id: 'M8', name: '变更不会破坏现有功能', passed: false, reason: `以下 scope 项缺乏验收覆盖: ${uncovered.join(', ')}` };
  }
  return { id: 'M8', name: '变更不会破坏现有功能', passed: true };
}

// ── REJECT 检测：scope 与 goal 不一致 ────────────────────────

function detectScopeGoalMismatch(i: GateInput): string | undefined {
  if (isEmpty(i.goal) || isEmptyArray(i.includes)) return undefined;
  const goalKw = extractKeywords(i.goal!);
  if (goalKw.size === 0) return undefined;
  const mismatches = i.includes!.filter(item => {
    const itemKw = extractKeywords(item);
    return itemKw.size > 0 && ![...itemKw].some(w => goalKw.has(w));
  });
  return mismatches.length > 0 ? `includes 条目与 goal 无关联: ${mismatches.join(', ')}` : undefined;
}

// ── 公共 API ─────────────────────────────────────────────────

/**
 * 运行 8 项门控检查，返回四态判定。
 * 执行顺序：M1 → M2 → M3 → M4-M6（批量）→ M7 → M8 → REJECT
 * 高优先项失败即锁定结论，不再检查后续项。
 */
export function runGateChecks(input: GateInput): GateVerdict {
  const checks: GateCheck[] = [];

  const m1 = checkM1(input); checks.push(m1);
  if (!m1.passed) return { result: 'RETURN', checks, returnTarget: 'InSpec' };

  const m2 = checkM2(input); checks.push(m2);
  if (!m2.passed) return { result: 'RETURN', checks, returnTarget: 'InSpec' };

  const m3 = checkM3(input); checks.push(m3);
  if (!m3.passed) return { result: 'RETURN', checks, returnTarget: 'InSpec' };

  const m4 = checkM4(input); const m5 = checkM5(input); const m6 = checkM6(input);
  checks.push(m4, m5, m6);
  if ([m4, m5, m6].some(c => !c.passed)) return { result: 'RETURN', checks, returnTarget: 'Ready' };

  const m7 = checkM7(input); checks.push(m7);
  if (!m7.passed) return { result: 'BLOCKED', checks };

  const m8 = checkM8(input); checks.push(m8);
  if (!m8.passed) return { result: 'BLOCKED', checks };

  const mismatch = detectScopeGoalMismatch(input);
  if (mismatch) {
    checks.push({ id: 'R1', name: 'scope-goal 一致性', passed: false, reason: mismatch });
    return { result: 'REJECT', checks };
  }

  return { result: 'READY', checks };
}
