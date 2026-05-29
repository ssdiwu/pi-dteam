---
title: "task 数据模型"
kind: definition
domain: P0-数据模型层
status: stable
tags: [task, 核心对象]
created: 2026-05-29
updated: 2026-05-29
---

# task 数据模型

> **定位**：dteam 的工作主语对象。一个完整的、有明确边界的功能或任务。

## 一句话

task 是你要做的**一件完整的功能**——从灵感到归档，跨会话存在，所有 worker 围绕它运转。

## 核心特征

| 特征 | 值 |
|------|-----|
| 生命周期 | 永久态：创建 → 执行 → 归档 |
| 持久化 | `.dteam/task/{name}-{timestamp}-{random4}.md` |
| 格式 | Markdown（统一格式） |
| 状态 | 5个：todo / InSpec / InProgress / Done / Cancelled |

## 文件命名

```
{name}-{timestamp}-{random4}.md
```

- `name`：任务名称（简短描述）
- `timestamp`：`YYYYMMDDHHmmss` 格式
- `random4`：4 位随机字符（防碰撞）
- 示例：`实现用户认证-20260529141206-ofi4.md`

## 文件结构

```markdown
# {任务名称}

## 基本信息
- ID: {timestamp}-{random4}
- 类型: functional/ui/bugfix/refactor/infra
- 创建时间: {timestamp}
- 状态: todo/InSpec/InProgress/Done/Cancelled

## 目标
- 为什么: {why}
- 做什么: {goal}

## 范围
- 包含: {includes}
- 排除: {excludes}

## 验收条件（GWT + 测试）
- [ ] 条件1（含测试）
- [ ] 条件2（含测试）
- [ ] 条件3（含测试）

## 阶段记录
### 探索发现
...

### 讨论决策
...

### 执行记录
...
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ID | string | ✅ | 全局唯一标识，格式 `{timestamp}-{random4}` |
| 类型 | enum | ✅ | functional / ui / bugfix / refactor / infra |
| 创建时间 | ISO8601 | ✅ | 创建时间 |
| 状态 | enum | ✅ | todo / InSpec / InProgress / Done / Cancelled |

## TaskType（5种）

| 值 | 含义 | 典型场景 |
|----|------|---------|
| `functional` | 功能开发 | 新增能力、特性实现 |
| `ui` | 界面/交互 | 前端UI改动、交互优化 |
| `bugfix` | 缺陷修复 | 修复已知问题 |
| `refactor` | 重构优化 | 代码结构调整、性能优化 |
| `infra` | 基础设施 | 构建配置、CI/CD、文档 |

## TaskStage（5种）

```
todo → InSpec → InProgress → Done
                  ↓
              Cancelled
```

| 阶段 | 含义 | 合法转移 |
|------|------|---------|
| `todo` | 待办 | → InSpec |
| `InSpec` | 探索中 | → InProgress |
| `InProgress` | 进行中 | → Done, Cancelled |
| `Done` | 完成 | 终态 |
| `Cancelled` | 取消 | 终态 |

## 工具接口

| 工具 | 功能 | 参数 |
|------|------|------|
| `task.create` | 创建新任务 | `{ name, type, why, goal }` |
| `task.read` | 读取指定section | `{ id, section }` |
| `task.update` | 更新指定section | `{ id, section, content }` |
| `task.complete` | 标记checklist项为完成 | `{ id, item }` |
| `task.archive` | 归档完成的任务 | `{ id }` |

## 不变量

1. `id` 全局唯一（格式 `{timestamp}-{random4}`）
2. `type` 必须是5个合法值之一
3. `stage` 必须是5个合法值之一
4. 验收条件必须包含GWT格式和对应测试
5. Done 和 Cancelled 为终态，不可逆转

## 存储位置

```
.dteam/
├── task/                          # 活跃任务
│   ├── {name}-{timestamp}-{random4}.md
│   └── ...
├── archive/                       # 归档任务（完成的任务）
│   ├── {name}-{timestamp}-{random4}.md
│   └── ...
└── pitfalls/                      # 经验库（可选）
    └── ...
```

## 示例

```markdown
# 实现用户认证

## 基本信息
- ID: 20260529141206-ofi4
- 类型: functional
- 创建时间: 2026-05-29T14:12:06Z
- 状态: todo

## 目标
- 为什么: 当前系统无任何身份验证机制，任何人可以访问所有API端点
- 做什么: 实现基于JWT的用户注册、登录和token刷新流程

## 范围
- 包含: 用户注册API、用户登录API、Token刷新API、中间件鉴权拦截器
- 排除: OAuth2第三方登录、密码重置邮件、多因素认证

## 验收条件（GWT + 测试）
- [ ] Given 未注册用户 When 通过POST /api/register注册 Then 返回201和有效token
- [ ] Given 已注册用户 When 凭据登录 Then 获得token
- [ ] Given 过期token When 通过refresh endpoint续期 Then 获得新token
- [ ] Given 无效token When 请求受保护API Then 返回401

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）
```
