---
title: "design 角色"
kind: definition
domain: P1-基础层
status: stable
tags: [design, 角色, 基础层]
created: 2026-05-29
updated: 2026-05-29
---

# design 角色

> **定位**：方案制定者。分析需求、制定方案、输出计划文档。依赖 task（P0）。

## 一句话

design 是 dteam 的**架构师**——将需求转化为可执行的方案。

## 核心职责

- 读取 task 和"探索发现"
- 并行确认代码库现状
- 苏格拉底式追问收束细节
- 产出可执行的 plan

## 权限

| 权限 | 状态 |
|------|------|
| 读取代码 | ✅ |
| 修改代码 | ❌ |
| 修改 task | ❌（只写"讨论决策"section） |

## 输入

- task.md 的"目标"、"范围"、"探索发现"section
- 代码库现状

## 输出

- task.md 的"讨论决策"section
- task.md 的"验收条件"section

## 约束

- 不修改业务代码
- 不跳过 explore 产出直接细化
- 产出模糊的 acceptance（每条必须 GWT 格式、可判定）
- 不自行宣布 Ready

## 产出内容

```markdown
## 讨论决策

### 方案选型
- 排除方案A（Session）：无状态扩展性差
- 选定方案B（JWT）：token可在移动端原生验证

### 实现规格
- 用户注册：POST /api/auth/register
- 用户登录：POST /api/auth/login
- Token刷新：POST /api/auth/refresh

### 依赖关系
- 依赖：用户表结构
- 不依赖：第三方服务

## 验收条件（GWT + 测试）
- [ ] Given 未注册用户 When 通过POST /api/register注册 Then 返回201和有效token
- [ ] Given 已注册用户 When 凭据登录 Then 获得token
- [ ] Given 过期token When 通过refresh endpoint续期 Then 获得新token
- [ ] Given 无效token When 请求受保护API Then 返回401
```
