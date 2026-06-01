# 优化prompt模板以引导AI使用worker

## 基本信息# 优化prompt模板以引导AI使用worker

## 基本信息

- **类型**：functional
- **状态**：Done
- **创建时间**：2026-06-01 02:48
- **最后更新**：2026-06-01 02:50

## 目标

更新prompt模板，在适当场景下明确指导AI使用worker工具，提升多代理编排能力的使用率

## 范围

### 包含

- 更新所有prompt模板（build/explore/design/check/deploy/close）
- 添加执行方式选择指导
- 明确简单任务和复杂任务的区别

### 排除

- 修改worker工具本身的代码
- 修改其他非prompt模板文件

## 目标
- 为什么: AI在执行build/explore等prompt时不会主动使用worker，因为prompt模板中没有提到worker的使用场景
- 做什么: 更新prompt模板，在适当场景下明确指导AI使用worker工具，提升多代理编排能力的使用率

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）- [x] 更新build.md模板，加入worker使用指导- [x] 更新explore.md模板，加入worker使用指导
- [x] 更新design.md模板，加入worker使用指导
- [x] 更新check.md模板，加入worker使用指导
- [x] 更新deploy.md模板，加入worker使用指导
- [x] 更新close.md模板，加入worker使用指导
- [x] 测试更新后的prompt模板是否有效（验证方式：grep 6个模板均包含 worker_create/worker_start/work 协议；npm test 80/80 通过）

## 阶段记录## 执行记录

### 2026-06-01 02:48 - 初始诊断

**问题**：AI在执行build/explore等prompt时不会主动使用worker

**原因**：prompt模板中没有提到worker工具的使用场景

**解决方案**：更新所有prompt模板，加入worker使用指导

### 修改内容

1. **build.md** - 添加执行方式选择，复杂任务使用worker
2. **explore.md** - 添加探索方式选择，复杂探索使用worker  
3. **design.md** - 添加设计方式选择，复杂设计使用worker
4. **check.md** - 添加验收方式选择，复杂验收使用worker
5. **deploy.md** - 添加部署方式选择，复杂部署使用worker
6. **close.md** - 添加检查方式选择，复杂检查使用worker

### 设计原则

- **简单任务**：直接执行，不需要worker
- **复杂任务**：使用worker_create创建worker，获得更好的执行上下文和协作能力

### 下一步

1. ~~测试更新后的prompt模板~~ ✅ 已验证
2. ~~观察AI是否会主动使用worker~~ ✅ 静态验证通过
3. ~~根据实际情况调整指导内容~~

### 收口记录（2026-06-01 14:22）

**变更清单**
- 修改: prompts/build.md, prompts/explore.md, prompts/design.md, prompts/check.md, prompts/deploy.md, prompts/close.md（共 6 个模板）

**Acceptance 逐条判定**
- AC1: ✅ PASS — explore.md 已加入 worker 使用指导
- AC2: ✅ PASS — design.md 已加入 worker 使用指导
- AC3: ✅ PASS — check.md 已加入 worker 使用指导
- AC4: ✅ PASS — deploy.md 已加入 worker 使用指导
- AC5: ✅ PASS — close.md 已加入 worker 使用指导
- AC6: ✅ PASS — grep 验证 6 个模板均包含 worker 关键词；npm test 80/80 通过

**遗留问题**
- 实际 AI 行为验证需在真实对话中观察，当前为静态代码验证通过

**踩坑/经验**
- 踩坑: prompt 模板需同时说明简单/复杂任务的分流逻辑，不能只加一句"使用 worker"
- 经验: prompt 设计应遵循"先给结论，再给必要细节"原则

