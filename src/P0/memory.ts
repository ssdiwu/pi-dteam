/**
 * P0-原子层：内存定义
 */

export interface MemoryEntry {
  key: string;
  value: unknown;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

// 通用内存接口
export interface MemoryAdapter {
  get(namespace: string, key: string): unknown | undefined;
  set(namespace: string, key: string, value: unknown, agentId: string): void;
  has(namespace: string, key: string): boolean;
  delete(namespace: string, key: string): boolean;
  keys(namespace: string): string[];
  clear(namespace: string): void;
}
