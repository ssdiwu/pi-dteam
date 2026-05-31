# core — 核心模块

> 共享内存和信号总线的早期实现，供参考。正式实现见 P1。

## 模块清单

| 文件 | 职责 |
|------|------|
| `signalBus.ts` | 信号总线早期实现（含 clearHistory） |
| `sharedMemory.ts` | 共享内存早期实现（基础版） |

## 说明

这两个文件是 P1 层 `signalBus.ts` 和 `sharedMemory.ts` 的前身。
当前代码主要使用 P1 层的实现，此目录保留供参考。
