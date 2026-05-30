/**
 * P0-原子层：状态定义
 */

export type WorkerStatus = "pending" | "running" | "done" | "failed";

export type TaskStatus = 
  | "pending"     // 待处理
  | "running"     // 运行中
  | "blocked"     // 阻塞
  | "done"        // 完成
  | "failed"      // 失败
  | "cancelled";  // 取消
