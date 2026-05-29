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
