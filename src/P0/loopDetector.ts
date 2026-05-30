/**
 * P0-原子层：循环检测器
 *
 * 防止渐进式参数变化和重复调用
 */

// ── 类型定义 ──────────────────────────────────────────────

interface ToolCallRecord {
  tool: string;
  args: string;
  timestamp: number;
}

export interface LoopDetectionResult {
  isLoop: boolean;
  reason?: string;
  suggestion?: string;
}

// ── 循环检测器 ──────────────────────────────────────────────

export class LoopDetector {
  private recentCalls: ToolCallRecord[] = [];
  private windowSize: number;
  private maxIdenticalCalls: number;
  private maxSimilarCalls: number;

  constructor(options?: {
    windowSize?: number;
    maxIdenticalCalls?: number;
    maxSimilarCalls?: number;
  }) {
    this.windowSize = options?.windowSize ?? 10;
    this.maxIdenticalCalls = options?.maxIdenticalCalls ?? 3;
    this.maxSimilarCalls = options?.maxSimilarCalls ?? 3;
  }

  /**
   * 记录工具调用
   */
  record(tool: string, args: any): void {
    this.recentCalls.push({
      tool,
      args: JSON.stringify(args, null, 0),
      timestamp: Date.now(),
    });
    if (this.recentCalls.length > this.windowSize) {
      this.recentCalls.shift();
    }
  }

  /**
   * 检测循环
   */
  check(tool: string, args: any): LoopDetectionResult {
    const argsStr = JSON.stringify(args, null, 0);

    // 检测1：完全相同的调用（工具名+参数都相同）
    const identicalCount = this.recentCalls.filter(
      (c) => c.tool === tool && c.args === argsStr
    ).length;
    if (identicalCount >= this.maxIdenticalCalls) {
      return {
        isLoop: true,
        reason: `连续 ${identicalCount} 次完全相同的 ${tool} 调用`,
        suggestion: "请换一种方式，或者问用户具体需要什么",
      };
    }

    // 检测2：渐进式参数变化（grep -A 60 → 70 → 80）
    const recentSameTool = this.recentCalls
      .slice(-this.maxSimilarCalls)
      .filter((c) => c.tool === tool);
    if (recentSameTool.length >= this.maxSimilarCalls) {
      if (this.isProgressivePattern(recentSameTool)) {
        return {
          isLoop: true,
          reason: `检测到渐进式参数变化模式（如 grep -A 60 → 70 → 80）`,
          suggestion: "禁止渐进式参数变化。小文件直接 read 全文，大文件先 read 开头了解结构再精准 grep",
        };
      }
    }

    // 检测3：文件大小检测（小文件直接全文，大文件先看头）
    if (tool === "read" || tool === "grep") {
      return this.checkFileSize(tool, args);
    }

    return { isLoop: false };
  }

  /**
   * 检测渐进式参数变化
   */
  private isProgressivePattern(calls: ToolCallRecord[]): boolean {
    if (calls.length < 3) return false;

    // 解析每个调用的参数
    const parsedArgs: any[] = [];
    for (const call of calls) {
      try {
        parsedArgs.push(JSON.parse(call.args));
      } catch {
        parsedArgs.push(null);
      }
    }

    // 检查是否所有参数都是对象
    const allObjects = parsedArgs.every(args => args !== null && typeof args === 'object');
    if (!allObjects) return false;

    // 提取每个调用参数值中的数字
    const numbersPerCall: number[][] = [];
    for (const args of parsedArgs) {
      const numbers: number[] = [];
      for (const value of Object.values(args)) {
        if (typeof value === 'number') {
          numbers.push(value);
        } else if (typeof value === 'string') {
          const matches = value.match(/\d+/g);
          if (matches) {
            numbers.push(...matches.map(Number));
          }
        }
      }
      numbersPerCall.push(numbers);
    }

    // 检查每个调用是否都有数字
    const allHaveNumbers = numbersPerCall.every(nums => nums.length > 0);
    if (!allHaveNumbers) return false;

    // 检查是否有递增模式（取每个调用的第一个数字）
    const firstNumbers = numbersPerCall.map(nums => nums[0]);
    if (firstNumbers.length >= 3) {
      let isIncreasing = true;
      for (let i = 1; i < firstNumbers.length; i++) {
        if (firstNumbers[i] <= firstNumbers[i - 1]) {
          isIncreasing = false;
          break;
        }
      }
      return isIncreasing;
    }

    return false;
  }

  /**
   * 文件大小检测
   * 小文件（<500行）直接查看全文
   * 大文件先看头再决定全文
   */
  private checkFileSize(tool: string, args: any): LoopDetectionResult {
    // 如果是read工具，检查是否指定了offset/limit
    if (tool === "read") {
      const hasOffset = args.offset !== undefined;
      const hasLimit = args.limit !== undefined;
      
      // 如果没有指定offset/limit，可能是尝试直接读取大文件
      if (!hasOffset && !hasLimit) {
        return {
          isLoop: false,
          suggestion: "建议：小文件（<500行）直接 read 全文，大文件先 read 开头了解结构",
        };
      }
    }

    return { isLoop: false };
  }

  /**
   * 清空历史记录
   */
  clear(): void {
    this.recentCalls = [];
  }
}
