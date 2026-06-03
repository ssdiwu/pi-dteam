# 修复 worker LLM 失败被误判为 done

## 基本信息
- ID: 20260603214411-avvv
- 类型: bugfix
- 创建时间: 2026-06-03T13:44:11.129Z
- 状态: todo

## 目标
- 为什么: 当前使用真实 LLM executor 时，spawn/model 失败可能被包装成普通字符串返回，solo worker 只把 throw 当失败，导致 worker 状态误判为 done，MiniMax-M3 等模型实施任务时会出现假成功。
- 做什么: 让 worker 在 LLM / model / spawn 失败时可靠进入 failed/blocked，而不是返回假 done；保证 worker 状态、共享内存诊断键、P4 终态显示与真实执行结果一致。

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）
- [ ] 

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
