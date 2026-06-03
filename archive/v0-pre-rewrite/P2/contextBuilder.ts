/**
 * P2-细胞层：上下文构建器
 * 
 * 负责构建完整的执行上下文，包括：
 * 1. 任务上下文
 * 2. 项目上下文
 * 3. 执行历史
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { WorkerConfig, getRequiredOption, normalizeOptions } from "../P0/config.js";
import { EnhancedSharedMemory } from "../P1/enhancedSharedMemory.js";
import { SignalBus } from "../P1/signalBus.js";
import { extractAcceptanceModel } from "../P0/workItem.js";

// ── 类型定义 ──────────────────────────────────────────────────

/**
 * 执行上下文接口
 */
export interface ExecutionContext {
  // ── 基础信息 ────────────────────────────────────────────────
  role: string;
  task: string;
  style: string;
  cwd: string;
  
  // ── 共享内存 ────────────────────────────────────────────────
  memory: EnhancedSharedMemory;
  
  // ── 信号总线 ────────────────────────────────────────────────
  bus: SignalBus;
  
  // ── 任务上下文 ──────────────────────────────────────────────
  taskContext: TaskContext;
  
  // ── 项目上下文 ──────────────────────────────────────────────
  projectContext: ProjectContext;
  
  // ── 执行历史 ────────────────────────────────────────────────
  executionHistory: ExecutionHistory;

  // ── 进度回调（可选，用于 TUI 实时显示） ──────────────────────
  onProgress?: (progress: import("../P1/spawn.js").AgentProgress) => void;

  // ── 嵌套关系（自 v0.4.2） ────────────────────────────────────
  /** 父 workerId（team/chain 嵌套时透传给子） */
  parentWorkerId?: string;
  /** chain step 序号（从 1 开始） */
  chainIndex?: number;
  /** chain 总步数 */
  chainTotal?: number;
}

/**
 * 任务上下文
 */
export interface TaskContext {
  id: string;
  name: string;
  type: string;
  status: string;
  goal: string;
  scope: {
    include: string[];
    exclude: string[];
  };
  acceptance: string[];
  sections: Record<string, string>;
}

/**
 * 项目上下文
 */
export interface ProjectContext {
  root: string;
  structure: DirectoryStructure;
  relatedFiles: RelatedFile[];
  dependencies: string[];
  config: ProjectConfig;
}

/**
 * 目录结构
 */
export interface DirectoryStructure {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: DirectoryStructure[];
  size?: number;
  modified?: number;
}

/**
 * 相关文件
 */
export interface RelatedFile {
  path: string;
  relevance: number;
  reason: string;
  content?: string;
}

/**
 * 项目配置
 */
export interface ProjectConfig {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: Record<string, string>;
}

/**
 * 执行历史
 */
export interface ExecutionHistory {
  previousResults: ExecutionResult[];
  decisions: Decision[];
  learnings: string[];
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  timestamp: number;
  role: string;
  task: string;
  result: string;
  success: boolean;
  duration: number;
}

/**
 * 决策记录
 */
export interface Decision {
  timestamp: number;
  context: string;
  options: string[];
  chosen: string;
  reason: string;
}

// ── 上下文构建器 ──────────────────────────────────────────────

/**
 * 上下文构建器
 */
export class ContextBuilder {
  constructor(
    private cwd: string,
    private memory: EnhancedSharedMemory,
    private bus: SignalBus,
  ) {}
  
  /**
   * 构建完整的执行上下文
   */
  async build(config: WorkerConfig): Promise<ExecutionContext> {
    // 下游兜底：即使上游 workerCreate 修复漏掉边角 case，
    // 也在 build 入口归一化 config.options，保证 find() 可调用。
    config.options = normalizeOptions(config.options);

    // 1. 构建上下文；project 相关文件依赖 task 关键词，需先得到 taskContext
    const taskContext = await this.buildTaskContext(config.task);
    const [projectContext, executionHistory] = await Promise.all([
      this.buildProjectContext(taskContext),
      this.buildExecutionHistory(),
    ]);
    
    // 2. 存储到共享内存
    this.memory.setMany('task', {
      details: taskContext,
      config: config,
    }, 'context-builder');
    
    this.memory.setMany('project', {
      structure: projectContext.structure,
      relatedFiles: projectContext.relatedFiles,
      dependencies: projectContext.dependencies,
      config: projectContext.config,
    }, 'context-builder');
    
    this.memory.setMany('execution', {
      history: executionHistory,
    }, 'context-builder');
    
    // 3. 返回完整上下文
    // chain/team 模式不需要 role，使用默认值
    const roleOption = config.options?.find(o => o.type === 'role');
    const role = config.type === 'solo' 
      ? getRequiredOption<string>(config.options, 'role')
      : (roleOption ? String(roleOption.value) : 'orchestrator');
    
    return {
      role,
      task: config.task,
      style: config.style,
      cwd: this.cwd,
      memory: this.memory,
      bus: this.bus,
      taskContext,
      projectContext,
      executionHistory,
    };
  }
  
  /**
   * 构建任务上下文
   */
  private async buildTaskContext(taskDescription: string): Promise<TaskContext> {
    // 尝试从 task 目录读取任务详情
    const taskDir = join(this.cwd, '.dteam/task');
    let taskContext: TaskContext = {
      id: '',
      name: '',
      type: '',
      status: '',
      goal: taskDescription,
      scope: { include: [], exclude: [] },
      acceptance: [],
      sections: {},
    };
    
    if (existsSync(taskDir)) {
      try {
        // 搜索相关任务
        const files = await readdir(taskDir);
        const taskFiles = files.filter(f => f.endsWith('.md'));
        
        // 简单匹配：查找包含任务描述关键词的文件
        const keywords = taskDescription.toLowerCase().split(/\s+/);
        
        for (const file of taskFiles) {
          const filepath = join(taskDir, file);
          const content = await readFile(filepath, 'utf-8');
          const contentLower = content.toLowerCase();
          
          // 检查是否匹配
          const matchCount = keywords.filter(kw => contentLower.includes(kw)).length;
          if (matchCount >= keywords.length * 0.5) {
            // 解析任务内容
            taskContext = this.parseTaskContent(content, file);
            break;
          }
        }
      } catch (error) {
        // 忽略错误，使用默认上下文
      }
    }
    
    return taskContext;
  }
  
  /**
   * 解析任务内容
   */
  private parseTaskContent(content: string, filename: string): TaskContext {
    const idMatch = filename.match(/(\d{14}-[a-z0-9]{4})/);
    const id = idMatch ? idMatch[1] : filename;
    
    const nameMatch = content.match(/^# (.+)$/m);
    const name = nameMatch ? nameMatch[1] : filename.replace(/-\d{14}-[a-z0-9]{4}\.md$/, '');
    
    const typeMatch = content.match(/类型:\s*(\w+)/);
    const type = typeMatch ? typeMatch[1] : 'unknown';
    
    const statusMatch = content.match(/状态:\s*(\w+)/);
    const status = statusMatch ? statusMatch[1] : 'unknown';
    
    const goalMatch = content.match(/## 目标\n([\s\S]*?)(?=\n## |$)/);
    const goal = goalMatch ? goalMatch[1].trim() : '';
    
    // 解析范围
    const scopeMatch = content.match(/## 范围\n([\s\S]*?)(?=\n## |$)/);
    const scopeContent = scopeMatch ? scopeMatch[1] : '';
    const includeMatch = scopeContent.match(/包含:\s*(.*)/);
    const excludeMatch = scopeContent.match(/排除:\s*(.*)/);
    
    // 解析验收条件（双层模型）
    // 默认 `acceptance` 只放 A 层可校验项；B 层人工裁决项不进 acceptance，
    // 但仍可通过 `sections["验收条件（分两层）"]` 拿到原文。
    // 兼容旧单层结构（无 A/B 子 section）→ 整段视作 A 层。
    const model = extractAcceptanceModel(content);
    const acceptance = model.machine.map((m) => m.acText);
    
    // 解析所有 section
    const sections: Record<string, string> = {};
    const sectionRegex = /## (.+)\n([\s\S]*?)(?=\n## |$)/g;
    let match;
    while ((match = sectionRegex.exec(content)) !== null) {
      sections[match[1].trim()] = match[2].trim();
    }
    
    return {
      id,
      name,
      type,
      status,
      goal,
      scope: {
        include: includeMatch ? includeMatch[1].split(',').map(s => s.trim()) : [],
        exclude: excludeMatch ? excludeMatch[1].split(',').map(s => s.trim()) : [],
      },
      acceptance,
      sections,
    };
  }
  
  /**
   * 构建项目上下文
   */
  private async buildProjectContext(taskContext: TaskContext): Promise<ProjectContext> {
    const structure = await this.getDirectoryStructure(this.cwd, 0, 3); // 最多3层
    const config = await this.getProjectConfig();
    const relatedFiles = await this.findRelatedFiles(taskContext);
    const dependencies = [
      ...(config.dependencies || []),
      ...(config.devDependencies || []),
    ];
    
    return {
      root: this.cwd,
      structure,
      relatedFiles,
      dependencies,
      config,
    };
  }
  
  /**
   * 获取目录结构
   */
  private async getDirectoryStructure(
    dirPath: string,
    currentDepth: number,
    maxDepth: number
  ): Promise<DirectoryStructure> {
    const name = dirPath.split('/').pop() || dirPath;
    const stats = await stat(dirPath);
    
    if (stats.isFile() || currentDepth >= maxDepth) {
      return {
        name,
        path: relative(this.cwd, dirPath),
        type: stats.isFile() ? 'file' : 'directory',
        size: stats.size,
        modified: stats.mtimeMs,
      };
    }
    
    // 目录：递归获取子项
    const children: DirectoryStructure[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      
      // 过滤隐藏文件和 node_modules
      const filteredEntries = entries.filter(entry => {
        const entryName = entry.name;
        return !entryName.startsWith('.') && 
               entryName !== 'node_modules' && 
               entryName !== 'dist' &&
               entryName !== 'build';
      });
      
      for (const entry of filteredEntries) {
        const entryPath = join(dirPath, entry.name);
        const child = await this.getDirectoryStructure(entryPath, currentDepth + 1, maxDepth);
        children.push(child);
      }
    } catch (error) {
      // 忽略权限错误
    }
    
    return {
      name,
      path: relative(this.cwd, dirPath),
      type: 'directory',
      children,
      modified: stats.mtimeMs,
    };
  }
  
  /**
   * 获取项目配置
   */
  private async getProjectConfig(): Promise<ProjectConfig> {
    const packageJsonPath = join(this.cwd, 'package.json');
    
    if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        return {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
          devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies) : [],
          scripts: pkg.scripts,
        };
      } catch (error) {
        // 忽略解析错误
      }
    }
    
    return {};
  }
  
  /**
   * 查找相关文件
   */
  private async findRelatedFiles(taskDetails: TaskContext): Promise<RelatedFile[]> {
    const keywords = taskDetails.goal.toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) {
      return [];
    }
    const relatedFiles: RelatedFile[] = [];
    
    // 搜索源代码目录
    const srcDirs = ['src', 'lib', 'app', 'pages', 'components'];
    
    for (const srcDir of srcDirs) {
      const srcPath = join(this.cwd, srcDir);
      if (existsSync(srcPath)) {
        await this.searchDirectory(srcPath, keywords, relatedFiles, 0, 2);
      }
    }
    
    // 按相关性排序
    relatedFiles.sort((a, b) => b.relevance - a.relevance);
    
    // 返回前10个
    return relatedFiles.slice(0, 10);
  }
  
  /**
   * 搜索目录
   */
  private async searchDirectory(
    dirPath: string,
    keywords: string[],
    results: RelatedFile[],
    currentDepth: number,
    maxDepth: number
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return;
    }
    
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        
        if (entry.isFile()) {
          // 只搜索代码文件
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs'].includes(ext || '')) {
            try {
              const content = await readFile(entryPath, 'utf-8');
              const contentLower = content.toLowerCase();
              
              // 计算匹配度
              const matchCount = keywords.filter(kw => contentLower.includes(kw)).length;
              const relevance = matchCount / keywords.length;
              
              if (relevance > 0.3) {
                results.push({
                  path: relative(this.cwd, entryPath),
                  relevance,
                  reason: `匹配 ${matchCount}/${keywords.length} 个关键词`,
                  content: content.substring(0, 1000), // 只保存前1000字符
                });
              }
            } catch (error) {
              // 忽略读取错误
            }
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          // 递归搜索子目录
          await this.searchDirectory(entryPath, keywords, results, currentDepth + 1, maxDepth);
        }
      }
    } catch (error) {
      // 忽略权限错误
    }
  }
  
  /**
   * 构建执行历史
   */
  private async buildExecutionHistory(): Promise<ExecutionHistory> {
    // 从共享内存获取历史
    const history = this.memory.get('execution', 'history') as ExecutionHistory | undefined;
    
    if (history) {
      return history;
    }
    
    // 默认空历史
    return {
      previousResults: [],
      decisions: [],
      learnings: [],
    };
  }
}

// ── 工厂函数 ──────────────────────────────────────────────────

/**
 * 创建上下文构建器
 */
export function createContextBuilder(
  cwd: string,
  memory: EnhancedSharedMemory,
  bus: SignalBus,
): ContextBuilder {
  return new ContextBuilder(cwd, memory, bus);
}

/**
 * 执行器类型
 */
export type Executor = (context: ExecutionContext) => Promise<string>;

/**
 * 创建执行器
 */
export function createExecutor(
  context: ExecutionContext,
  executeFn: (context: ExecutionContext) => Promise<string>,
): Executor {
  return async (ctx) => {
    const startTime = Date.now();
    
    try {
      // 执行任务
      const result = await executeFn(ctx);
      
      // 记录执行结果
      const executionResult: ExecutionResult = {
        timestamp: Date.now(),
        role: ctx.role,
        task: ctx.task,
        result,
        success: true,
        duration: Date.now() - startTime,
      };
      
      // 更新共享内存
      const history = ctx.executionHistory;
      history.previousResults.push(executionResult);
      ctx.memory.set('execution', 'history', history, ctx.role);
      
      // 发送信号
      ctx.bus.emit('progress', ctx.role, { status: 'done', result });
      
      return result;
    } catch (error) {
      // 记录失败结果
      const executionResult: ExecutionResult = {
        timestamp: Date.now(),
        role: ctx.role,
        task: ctx.task,
        result: (error as Error).message,
        success: false,
        duration: Date.now() - startTime,
      };
      
      // 更新共享内存
      const history = ctx.executionHistory;
      history.previousResults.push(executionResult);
      ctx.memory.set('execution', 'history', history, ctx.role);
      
      // 发送信号
      ctx.bus.emit('blocked', ctx.role, { error: (error as Error).message });
      
      throw error;
    }
  };
}
