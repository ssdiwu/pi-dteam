---
title: "close 角色"
kind: definition
domain: P2-角色执行层
status: stable
tags: [close, 角色]
created: 2026-05-29
updated: 2026-05-29
---

# close 角色

> **定位**：收口者。整理归档、记录经验、关闭任务。

## 一句话

close 是 dteam 的**档案员**——整理经验，归档任务。

## 核心职责

- 汇总 execution summary
- 记录踩坑/经验
- 标记 task Done
- 归档任务

## 权限

| 权限 | 状态 |
|------|------|
| 读取代码 | ✅ |
| 修改代码 | ❌ |
| 修改 task | ✅（归档操作） |

## 输入

- task.md 的所有 section
- 执行过程中的经验教训

## 输出

- task 归档到 .dteam/archive/
- 经验记录到 .dteam/pitfalls/（可选）

## 约束

- 不修改业务代码
- 在 acceptance 未全部 PASS 时不能收口
- 不跳过踩坑/经验记录
- 不跳过 acceptance 证据检查

## 收口流程

```
检查 acceptance 是否全部 PASS
    │
    ├─ 否 → 拒绝收口，返回给 build/check
    │
    ▼ 是
记录经验教训
    │
    ▼
更新 task 状态为 Done
    │
    ▼
归档 task 到 .dteam/archive/
```

## 产出内容

```markdown
## 收口记录

### 经验教训
- JWT token刷新需要处理边界情况（token过期但refresh有效）
- 密码加密使用bcrypt是正确的选择

### 踩坑记录
- 初始设计没有考虑token刷新的并发问题
- 测试用例需要覆盖更多边界情况

### 归档信息
- 归档时间：2026-05-29T16:00:00Z
- 归档原因：全部验收条件通过
```
