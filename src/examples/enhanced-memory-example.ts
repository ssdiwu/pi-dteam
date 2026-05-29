/**
 * 增强共享内存和上下文构建器使用示例
 * 
 * 这个示例展示了如何：
 * 1. 创建增强的共享内存
 * 2. 使用上下文构建器构建执行上下文
 * 3. 注册自定义执行器
 * 4. 执行任务并查看结果
 */

import { createEnhancedSharedMemory } from "../P1/enhancedSharedMemory.js";
import { createContextBuilder, ExecutionContext } from "../P2/contextBuilder.js";
import { SignalBus } from "../P1/signalBus.js";
import { WorkerConfig } from "../P0/config.js";

// ── 示例 1：基本使用 ──────────────────────────────────────────

async function basicUsageExample() {
  console.log("=== 示例 1：基本使用 ===\n");
  
  // 1. 创建增强的共享内存
  const memory = createEnhancedSharedMemory();
  
  // 2. 创建信号总线
  const bus = new SignalBus();
  
  // 3. 创建上下文构建器
  const cwd = process.cwd();
  const contextBuilder = createContextBuilder(cwd, memory, bus);
  
  // 4. 定义 worker 配置
  const config: WorkerConfig = {
    type: "solo",
    task: "实现用户登录功能",
    style: "explore",
    options: [
      { type: "role", value: "build" },
    ],
  };
  
  // 5. 构建执行上下文
  const context = await contextBuilder.build(config);
  
  // 6. 查看上下文信息
  console.log("角色:", context.role);
  console.log("任务:", context.task);
  console.log("风格:", context.style);
  console.log("工作目录:", context.cwd);
  
  console.log("\n任务上下文:");
  console.log("  目标:", context.taskContext.goal);
  console.log("  类型:", context.taskContext.type);
  console.log("  状态:", context.taskContext.status);
  
  console.log("\n项目上下文:");
  console.log("  根目录:", context.projectContext.root);
  console.log("  依赖数量:", context.projectContext.dependencies.length);
  console.log("  相关文件数量:", context.projectContext.relatedFiles.length);
  
  console.log("\n执行历史:");
  console.log("  历史结果数量:", context.executionHistory.previousResults.length);
  console.log("  历史决策数量:", context.executionHistory.decisions.length);
  console.log("  经验教训数量:", context.executionHistory.learnings.length);
}

// ── 示例 2：共享内存操作 ──────────────────────────────────────

async function sharedMemoryExample() {
  console.log("\n=== 示例 2：共享内存操作 ===\n");
  
  const memory = createEnhancedSharedMemory();
  
  // 1. 基础操作
  console.log("1. 基础操作:");
  memory.set("task", "current", "实现用户登录", "agent-1");
  memory.set("task", "status", "in-progress", "agent-1");
  
  const currentTask = memory.get("task", "current");
  const taskStatus = memory.get("task", "status");
  console.log("  当前任务:", currentTask);
  console.log("  任务状态:", taskStatus);
  
  // 2. 批量操作
  console.log("\n2. 批量操作:");
  memory.setMany("project", {
    name: "pi-dteam",
    version: "0.1.0",
    description: "轻量级多代理编排系统",
  }, "agent-1");
  
  const projectInfo = memory.getMany("project", ["name", "version", "description"]);
  console.log("  项目信息:", projectInfo);
  
  // 3. 查询操作
  console.log("\n3. 查询操作:");
  const taskKeys = memory.keys("task");
  console.log("  task 命名空间的键:", taskKeys);
  
  const namespaces = memory.namespaces();
  console.log("  所有命名空间:", namespaces);
  
  // 4. 历史追踪
  console.log("\n4. 历史追踪:");
  memory.set("task", "status", "completed", "agent-2");
  memory.set("task", "status", "archived", "agent-3");
  
  const history = memory.history("task", "status");
  console.log("  status 修改历史:");
  history.forEach((entry, index) => {
    console.log(`    ${index + 1}. ${entry.value} (by ${entry.agentId})`);
  });
  
  // 5. 快照功能
  console.log("\n5. 快照功能:");
  const snapshot = memory.snapshot();
  console.log("  快照时间:", new Date(snapshot.timestamp).toISOString());
  console.log("  快照命名空间数量:", Object.keys(snapshot.namespaces).length);
  
  // 6. 持久化
  console.log("\n6. 持久化:");
  const snapshotPath = "/tmp/memory-snapshot.json";
  await memory.save(snapshotPath);
  console.log("  已保存到:", snapshotPath);
  
  // 创建新实例并加载
  const newMemory = createEnhancedSharedMemory();
  await newMemory.load(snapshotPath);
  
  const loadedTask = newMemory.get("task", "current");
  console.log("  加载后任务:", loadedTask);
}

// ── 示例 3：自定义执行器 ──────────────────────────────────────

async function customExecutorExample() {
  console.log("\n=== 示例 3：自定义执行器 ===\n");
  
  const memory = createEnhancedSharedMemory();
  const bus = new SignalBus();
  const cwd = process.cwd();
  const contextBuilder = createContextBuilder(cwd, memory, bus);
  
  // 定义自定义执行器
  const customExecutor = async (context: ExecutionContext): Promise<string> => {
    const { role, task, style, taskContext, projectContext } = context;
    
    // 模拟执行过程
    console.log(`执行器开始执行: ${role}`);
    console.log(`  任务: ${task}`);
    console.log(`  风格: ${style}`);
    
    // 从共享内存获取历史
    const history = context.memory.get("execution", "history");
    if (history) {
      console.log(`  历史结果: ${(history as any).previousResults?.length || 0} 个`);
    }
    
    // 模拟执行时间
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 返回结果
    return `[${role}] 完成任务: ${task}\n` +
           `  目标: ${taskContext.goal}\n` +
           `  项目: ${projectContext.root}\n` +
           `  风格: ${style}`;
  };
  
  // 注册执行器
  const { registerExecutor } = await import("../tools/worker.js");
  registerExecutor("custom", customExecutor);
  
  // 创建 worker 配置
  const config: WorkerConfig = {
    type: "solo",
    task: "实现用户注册功能",
    style: "build",
    options: [
      { type: "role", value: "build" },
    ],
  };
  
  // 构建上下文并执行
  const context = await contextBuilder.build(config);
  const result = await customExecutor(context);
  
  console.log("\n执行结果:");
  console.log(result);
  
  // 查看共享内存中的数据
  console.log("\n共享内存中的数据:");
  const taskData = memory.get("task", "details");
  console.log("  任务详情:", taskData ? "已存储" : "未存储");
  
  const projectData = memory.get("project", "structure");
  console.log("  项目结构:", projectData ? "已存储" : "未存储");
}

// ── 示例 4：多 worker 协作 ────────────────────────────────────

async function multiWorkerExample() {
  console.log("\n=== 示例 4：多 worker 协作 ===\n");
  
  const memory = createEnhancedSharedMemory();
  const bus = new SignalBus();
  const cwd = process.cwd();
  const contextBuilder = createContextBuilder(cwd, memory, bus);
  
  // Worker 1: 探索阶段
  const exploreConfig: WorkerConfig = {
    type: "solo",
    task: "探索项目结构",
    style: "explore",
    options: [{ type: "role", value: "explore" }],
  };
  
  // Worker 2: 设计阶段
  const designConfig: WorkerConfig = {
    type: "solo",
    task: "设计系统架构",
    style: "design",
    options: [{ type: "role", value: "design" }],
  };
  
  // Worker 3: 实现阶段
  const buildConfig: WorkerConfig = {
    type: "solo",
    task: "实现核心功能",
    style: "build",
    options: [{ type: "role", value: "build" }],
  };
  
  // 执行探索阶段
  console.log("1. 执行探索阶段:");
  const exploreContext = await contextBuilder.build(exploreConfig);
  console.log("  角色:", exploreContext.role);
  console.log("  任务:", exploreContext.task);
  
  // 存储探索结果
  memory.set("exploration", "structure", {
    src: ["components", "utils", "services"],
    tests: ["unit", "integration"],
  }, "explore");
  
  memory.set("exploration", "findings", [
    "项目使用 TypeScript",
    "有完善的测试覆盖",
    "使用 ESLint 进行代码检查",
  ], "explore");
  
  // 执行设计阶段
  console.log("\n2. 执行设计阶段:");
  const designContext = await contextBuilder.build(designConfig);
  console.log("  角色:", designContext.role);
  console.log("  任务:", designContext.task);
  
  // 从共享内存获取探索结果
  const explorationStructure = memory.get("exploration", "structure");
  const explorationFindings = memory.get("exploration", "findings");
  console.log("  获取探索结果:", explorationStructure ? "成功" : "失败");
  console.log("  探索发现:", explorationFindings);
  
  // 存储设计决策
  memory.set("design", "decisions", [
    { context: "架构选择", options: ["单体", "微服务"], chosen: "单体", reason: "项目规模小" },
    { context: "状态管理", options: ["Redux", "Zustand"], chosen: "Zustand", reason: "更轻量" },
  ], "design");
  
  // 执行实现阶段
  console.log("\n3. 执行实现阶段:");
  const buildContext = await contextBuilder.build(buildConfig);
  console.log("  角色:", buildContext.role);
  console.log("  任务:", buildContext.task);
  
  // 从共享内存获取设计决策
  const designDecisions = memory.get("design", "decisions");
  console.log("  获取设计决策:", designDecisions ? "成功" : "失败");
  console.log("  设计决策:", designDecisions);
  
  // 查看完整的执行历史
  console.log("\n4. 执行历史:");
  const history = memory.get("execution", "history");
  console.log("  历史记录:", history ? "已存储" : "未存储");
  
  // 查看所有命名空间
  console.log("\n5. 共享内存状态:");
  const namespaces = memory.namespaces();
  console.log("  命名空间:", namespaces);
  
  for (const ns of namespaces) {
    const keys = memory.keys(ns);
    console.log(`  ${ns}: ${keys.join(", ")}`);
  }
}

// ── 主函数 ────────────────────────────────────────────────────

async function main() {
  try {
    await basicUsageExample();
    await sharedMemoryExample();
    await customExecutorExample();
    await multiWorkerExample();
    
    console.log("\n=== 所有示例执行完成 ===");
  } catch (error) {
    console.error("示例执行失败:", error);
  }
}

// 运行示例
main();
