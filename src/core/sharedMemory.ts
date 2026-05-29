/**
 * 共享内存实现
 *
 * 内存存储，按任务范围划分命名空间
 */

// ── 类型定义 ──────────────────────────────────────────────────

export type AgentLevel = "readonly" | "readwrite";

export interface MemoryEntry {
	key: string;
	value: unknown;
	createdAt: number;
	updatedAt: number;
	createdBy: string;
}

// ── 共享内存 ──────────────────────────────────────────────────

export class SharedMemory {
	private namespaces: Map<string, Map<string, MemoryEntry>> = new Map();

	/**
	 * 设置值
	 */
	set(namespace: string, key: string, value: unknown, agentId: string): void {
		if (!this.namespaces.has(namespace)) {
			this.namespaces.set(namespace, new Map());
		}

		const ns = this.namespaces.get(namespace)!;
		const now = Date.now();

		const existing = ns.get(key);
		if (existing) {
			existing.value = value;
			existing.updatedAt = now;
		} else {
			ns.set(key, {
				key,
				value,
				createdAt: now,
				updatedAt: now,
				createdBy: agentId,
			});
		}
	}

	/**
	 * 获取值
	 */
	get(namespace: string, key: string): unknown | undefined {
		const ns = this.namespaces.get(namespace);
		if (!ns) return undefined;

		const entry = ns.get(key);
		return entry?.value;
	}

	/**
	 * 获取条目
	 */
	getEntry(namespace: string, key: string): MemoryEntry | undefined {
		const ns = this.namespaces.get(namespace);
		if (!ns) return undefined;

		return ns.get(key);
	}

	/**
	 * 列出命名空间下的所有键
	 */
	keys(namespace: string): string[] {
		const ns = this.namespaces.get(namespace);
		if (!ns) return [];

		return Array.from(ns.keys());
	}

	/**
	 * 检查键是否存在
	 */
	has(namespace: string, key: string): boolean {
		const ns = this.namespaces.get(namespace);
		if (!ns) return false;

		return ns.has(key);
	}

	/**
	 * 删除键
	 */
	delete(namespace: string, key: string): boolean {
		const ns = this.namespaces.get(namespace);
		if (!ns) return false;

		return ns.delete(key);
	}

	/**
	 * 清空命名空间
	 */
	clear(namespace: string): void {
		this.namespaces.delete(namespace);
	}

	/**
	 * 清空所有
	 */
	clearAll(): void {
		this.namespaces.clear();
	}
}
