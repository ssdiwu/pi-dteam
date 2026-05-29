/**
 * P1-分子层：增强的共享内存
 * 
 * 在原有 SharedMemory 基础上增加：
 * 1. 持久化支持
 * 2. 批量操作
 * 3. 历史追踪
 * 4. 快照功能
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

// ── 类型定义 ──────────────────────────────────────────────────

/**
 * 内存条目（增强版）
 */
export interface MemoryEntry {
  key: string;
  value: unknown;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  version: number;
}

/**
 * 历史记录条目
 */
export interface MemoryHistoryEntry {
  value: unknown;
  timestamp: number;
  agentId: string;
  version: number;
}

/**
 * 内存快照
 */
export interface MemorySnapshot {
  timestamp: number;
  namespaces: Record<string, Record<string, MemoryEntry>>;
}

/**
 * 增强的共享内存接口
 */
export interface EnhancedSharedMemory {
  // ── 基础操作（兼容原有接口）────────────────────────────────
  set(namespace: string, key: string, value: unknown, agentId: string): void;
  get(namespace: string, key: string): unknown | undefined;
  keys(namespace: string): string[];
  has(namespace: string, key: string): boolean;
  delete(namespace: string, key: string): boolean;
  clear(namespace: string): void;
  
  // ── 持久化 ──────────────────────────────────────────────────
  save(filepath: string): Promise<void>;
  load(filepath: string): Promise<void>;
  
  // ── 批量操作 ────────────────────────────────────────────────
  setMany(namespace: string, entries: Record<string, unknown>, agentId: string): void;
  getMany(namespace: string, keys: string[]): Record<string, unknown>;
  
  // ── 查询 ────────────────────────────────────────────────────
  getByPrefix(namespace: string, prefix: string): Record<string, unknown>;
  namespaces(): string[];
  
  // ── 历史追踪 ────────────────────────────────────────────────
  history(namespace: string, key: string): MemoryHistoryEntry[];
  
  // ── 快照 ────────────────────────────────────────────────────
  snapshot(): MemorySnapshot;
  restore(snapshot: MemorySnapshot): void;
}

// ── 实现 ──────────────────────────────────────────────────────

/**
 * 增强的共享内存实现
 */
export class EnhancedSharedMemoryImpl implements EnhancedSharedMemory {
  private namespaceStore: Map<string, Map<string, MemoryEntry>> = new Map();
  private historyStore: Map<string, MemoryHistoryEntry[]> = new Map();
  private versionCounters: Map<string, number> = new Map();

  // ── 基础操作 ────────────────────────────────────────────────

  /**
   * 设置值
   */
  set(namespace: string, key: string, value: unknown, agentId: string): void {
    if (!this.namespaceStore.has(namespace)) {
      this.namespaceStore.set(namespace, new Map());
    }

    const ns = this.namespaceStore.get(namespace)!;
    const now = Date.now();
    const historyKey = `${namespace}:${key}`;

    // 获取或初始化版本号
    const versionKey = `${namespace}:${key}`;
    const currentVersion = this.versionCounters.get(versionKey) || 0;
    const newVersion = currentVersion + 1;
    this.versionCounters.set(versionKey, newVersion);

    // 保存历史记录
    if (!this.historyStore.has(historyKey)) {
      this.historyStore.set(historyKey, []);
    }
    const history = this.historyStore.get(historyKey)!;
    
    const existing = ns.get(key);
    if (existing) {
      // 保存旧值到历史
      history.push({
        value: existing.value,
        timestamp: existing.updatedAt,
        agentId: existing.createdBy,
        version: existing.version,
      });
      
      // 更新现有条目
      existing.value = value;
      existing.updatedAt = now;
      existing.createdBy = agentId;
      existing.version = newVersion;
    } else {
      // 创建新条目
      ns.set(key, {
        key,
        value,
        createdAt: now,
        updatedAt: now,
        createdBy: agentId,
        version: newVersion,
      });
    }
  }

  /**
   * 获取值
   */
  get(namespace: string, key: string): unknown | undefined {
    const ns = this.namespaceStore.get(namespace);
    if (!ns) return undefined;

    const entry = ns.get(key);
    return entry?.value;
  }

  /**
   * 列出命名空间下的所有键
   */
  keys(namespace: string): string[] {
    const ns = this.namespaceStore.get(namespace);
    if (!ns) return [];

    return Array.from(ns.keys());
  }

  /**
   * 检查键是否存在
   */
  has(namespace: string, key: string): boolean {
    const ns = this.namespaceStore.get(namespace);
    if (!ns) return false;

    return ns.has(key);
  }

  /**
   * 删除键
   */
  delete(namespace: string, key: string): boolean {
    const ns = this.namespaceStore.get(namespace);
    if (!ns) return false;

    return ns.delete(key);
  }

  /**
   * 清空命名空间
   */
  clear(namespace: string): void {
    this.namespaceStore.delete(namespace);
  }

  // ── 持久化 ──────────────────────────────────────────────────

  /**
   * 保存到文件
   */
  async save(filepath: string): Promise<void> {
    const dir = dirname(filepath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const snapshot = this.snapshot();
    const content = JSON.stringify(snapshot, null, 2);
    await writeFile(filepath, content, "utf-8");
  }

  /**
   * 从文件加载
   */
  async load(filepath: string): Promise<void> {
    if (!existsSync(filepath)) {
      return;
    }

    const content = await readFile(filepath, "utf-8");
    const snapshot = JSON.parse(content) as MemorySnapshot;
    this.restore(snapshot);
  }

  // ── 批量操作 ────────────────────────────────────────────────

  /**
   * 批量设置
   */
  setMany(namespace: string, entries: Record<string, unknown>, agentId: string): void {
    for (const [key, value] of Object.entries(entries)) {
      this.set(namespace, key, value, agentId);
    }
  }

  /**
   * 批量获取
   */
  getMany(namespace: string, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = this.get(namespace, key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  // ── 查询 ────────────────────────────────────────────────────

  /**
   * 按前缀查询
   */
  getByPrefix(namespace: string, prefix: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const ns = this.namespaceStore.get(namespace);
    if (!ns) return result;

    for (const [key, entry] of ns.entries()) {
      if (key.startsWith(prefix)) {
        result[key] = entry.value;
      }
    }
    return result;
  }

  /**
   * 获取所有命名空间
   */
  namespaces(): string[] {
    return Array.from(this.namespaceStore.keys());
  }

  // ── 历史追踪 ────────────────────────────────────────────────

  /**
   * 获取键的修改历史
   */
  history(namespace: string, key: string): MemoryHistoryEntry[] {
    const historyKey = `${namespace}:${key}`;
    return this.historyStore.get(historyKey) || [];
  }

  // ── 快照 ────────────────────────────────────────────────────

  /**
   * 创建快照
   */
  snapshot(): MemorySnapshot {
    const namespaces: Record<string, Record<string, MemoryEntry>> = {};
    
    for (const [nsName, ns] of this.namespaceStore.entries()) {
      namespaces[nsName] = {};
      for (const [key, entry] of ns.entries()) {
        namespaces[nsName][key] = { ...entry };
      }
    }

    return {
      timestamp: Date.now(),
      namespaces,
    };
  }

  /**
   * 从快照恢复
   */
  restore(snapshot: MemorySnapshot): void {
    this.namespaceStore.clear();
    this.historyStore.clear();
    this.versionCounters.clear();

    for (const [nsName, entries] of Object.entries(snapshot.namespaces)) {
      const ns = new Map<string, MemoryEntry>();
      for (const [key, entry] of Object.entries(entries)) {
        ns.set(key, { ...entry });
        this.versionCounters.set(`${nsName}:${key}`, entry.version);
      }
      this.namespaceStore.set(nsName, ns);
    }
  }
}

// ── 工厂函数 ──────────────────────────────────────────────────

/**
 * 创建增强的共享内存实例
 */
export function createEnhancedSharedMemory(): EnhancedSharedMemory {
  return new EnhancedSharedMemoryImpl();
}

/**
 * 从原有的 SharedMemory 迁移
 */
export function migrateFromLegacySharedMemory(
  legacy: { get: (namespace: string, key: string) => unknown | undefined; keys: (namespace: string) => string[] }
): EnhancedSharedMemory {
  const enhanced = new EnhancedSharedMemoryImpl();
  
  // 迁移数据
  for (const namespace of legacy.keys('')) {
    const keys = legacy.keys(namespace);
    for (const key of keys) {
      const value = legacy.get(namespace, key);
      if (value !== undefined) {
        enhanced.set(namespace, key, value, 'migration');
      }
    }
  }
  
  return enhanced;
}
