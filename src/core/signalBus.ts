/**
 * 信号总线实现
 *
 * 4个信号 + 5个策略 = 9种信号类型
 */

// ── 信号类型 ──────────────────────────────────────────────────

export type SignalType = "progress" | "blocked" | "found" | "help";
export type StrategyType = "retry" | "adjust" | "switch" | "replan" | "learn";

export interface Signal {
	id: string;
	type: SignalType;
	workerId: string;
	timestamp: number;
	data: Record<string, unknown>;
}

export interface Strategy {
	type: StrategyType;
	description: string;
	params?: Record<string, unknown>;
}

// ── 信号总线 ──────────────────────────────────────────────────

export class SignalBus {
	private listeners: Map<SignalType, Array<(signal: Signal) => void>> = new Map();
	private history: Signal[] = [];

	/**
	 * 发送信号
	 */
	emit(type: SignalType, workerId: string, data: Record<string, unknown> = {}): Signal {
		const signal: Signal = {
			id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			type,
			workerId,
			timestamp: Date.now(),
			data,
		};

		this.history.push(signal);

		// 通知监听器
		const listeners = this.listeners.get(type) || [];
		for (const listener of listeners) {
			listener(signal);
		}

		return signal;
	}

	/**
	 * 监听信号
	 */
	on(type: SignalType, listener: (signal: Signal) => void): () => void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, []);
		}
		this.listeners.get(type)!.push(listener);

		// 返回取消监听函数
		return () => {
			const listeners = this.listeners.get(type);
			if (listeners) {
				const index = listeners.indexOf(listener);
				if (index > -1) {
					listeners.splice(index, 1);
				}
			}
		};
	}

	/**
	 * 获取信号历史
	 */
	getHistory(workerId?: string): Signal[] {
		if (workerId) {
			return this.history.filter((s) => s.workerId === workerId);
		}
		return [...this.history];
	}

	/**
	 * 清空信号历史
	 */
	clearHistory(): void {
		this.history = [];
	}
}
