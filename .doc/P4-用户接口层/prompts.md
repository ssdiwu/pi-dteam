---
title: "prompts 定义"
kind: definition
domain: P4-用户接口层
status: stable
tags: [prompts, 用户接口]
created: 2026-05-29
updated: 2026-05-29
---

# prompts 定义

> **定位**：dteam 的用户接口层。定义所有 prompt 模板，供用户使用。

## 一句话

prompts 是 dteam 的**用户入口**——通过 `/命令` 触发 worker 启动器。

## Prompt 模板清单（6个）

| 模板 | 命令 | 功能 | 整合功能 |
|------|------|------|----------|
| `explore.md` | `/explore` | 探索者启动器 | explain |
| `design.md` | `/design` | 方案制定者启动器 | - |
| `build.md` | `/build` | 实现者启动器 | fix、test |
| `deploy.md` | `/deploy` | 部署者启动器 | - |
| `check.md` | `/check` | 验收者启动器 | review |
| `close.md` | `/close` | 收口者启动器 | commit |

## 开发全流程

```
用户需求
    │
    ▼
/explore → /design → /build → /check → /deploy → /close
（探索）   （设计）   （实现）   （验收）   （部署）   （收口）
```

## Prompt 详细说明

### /explore — 探索者启动器

**职责**：
- 搜集内部信息（项目内的代码、文档、架构）
- 搜集外部信息（联网搜索、同类项目、同类问题）

**产出**：
- task.md 的"探索发现"section

**使用场景**：
- 了解项目现状
- 发现约束条件
- 查找同类问题

---

### /design — 方案制定者启动器

**职责**：
- 需求评估（didea）：评估任务复杂度
- 方向探索（dpth）：补充scope/gaps/reality
- 需求细化（dref）：制定实现方案
- 架构选择：选择合适的架构模式

**产出**：
- task.md 的"讨论决策"section
- task.md 的"验收条件"section

**使用场景**：
- 制定任务方案
- 选择架构模式
- 拆分任务

---

### /build — 实现者启动器

**职责**：
- 执行代码修改
- 更新文档
- 编写测试

**产出**：
- 代码变更
- 文档更新
- 测试用例
- task.md 的"执行记录"section

**使用场景**：
- 实现功能
- 修复bug
- 重构代码

---

### /check — 验收者启动器

**职责**：
- 检查代码问题
- 检查代码和文档一致性
- 逐条检查验收条件

**产出**：
- task.md 的"验收条件"section 更新

**使用场景**：
- 验收任务
- 质量检查
- 文档一致性检查

---

### /deploy — 部署者启动器

**职责**：
- 验证验收条件是否全部 PASS
- 执行构建命令
- 执行部署命令
- 验证部署结果（健康检查、冒烟测试）

**产出**：
- task.md 的“部署记录”section
- 部署成功的服务

**使用场景**：
- 部署到生产环境
- 发布新版本
- 执行 CI/CD 流程

---

### /close — 收口者启动器

**职责**：
- 检查代码和文档的gap
- 记录经验教训
- 归档任务

**产出**：
- task.md 的"收口记录"section
- task 归档到 .dteam/archive/

**使用场景**：
- 完成任务
- 记录经验
- 归档任务

## 使用示例

### 完整流程示例

```
# 1. 探索
/explore 实现用户认证功能

# 2. 设计
/design 实现用户认证功能

# 3. 实现
/build 实现用户认证功能

# 4. 验收
/check 实现用户认证功能

# 5. 部署
/deploy 实现用户认证功能

# 6. 收口
/close 实现用户认证功能
```

### 单独使用示例

```
# 只探索
/explore 了解项目架构

# 只设计
/design 设计认证方案

# 只实现
/build 修复登录bug

# 只验收
/check 验收用户认证功能

# 只部署
/deploy 部署用户认证功能

# 只收口
/close 归档用户认证任务
```

## 与工具接口的关系

prompts 使用工具接口来操作 task：

| prompt | 使用的工具 |
|--------|-----------|
| `/explore` | task.read、task.update |
| `/design` | task.create、task.read、task.update、reference.architecture、reference.thinking |
| `/build` | task.read、task.update |
| `/deploy` | task.read、task.update |
| `/check` | task.read、task.update、task.complete |
| `/close` | task.read、task.update、task.archive、task.list、task.search |
