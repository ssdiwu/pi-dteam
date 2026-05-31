# pi-dteam

> 轻量级多代理编排系统 — 基于 Pi 的多代理工作流框架

[English](./README.md) | 中文

## 概述

dteam 是一个 **Pi 扩展包**，提供轻量级的多代理编排能力。通过 solo/chain/team 三种模式，在高效与有效之间取得平衡。

## 核心概念

- **task**：工作主语对象（Markdown格式）
- **worker**：执行单元（solo/chain/team三种模式）
- **角色**：5个执行角色（explore/design/build/check/close）
- **信号**：即时通信机制（4个信号 + 5个策略 = 9种）

## 安装

```bash
# 通过 git 安装（推荐）
pi install git:github.com/ssdiwu/pi-dteam

# 或通过本地路径
pi install /path/to/pi-dteam
```

## 使用

### 命令

```
/explore 任务描述    # 探索者：搜集内部和外部信息
/design 任务描述     # 方案制定者：评估需求、制定方案
/build 任务描述      # 实现者：执行计划、编写代码、更新文档、编写测试
/check 任务描述      # 验收者：检查代码质量、验证结果
/close 任务描述      # 收口者：整理归档、记录经验、关闭任务
```

### 工具

#### Task 工具

| 工具 | 功能 |
|------|------|
| `task_create` | 创建新的 task |
| `task_read` | 读取 task 的指定 section |
| `task_update` | 更新 task 的指定 section |
| `task_complete` | 标记 checklist 项为完成 |
| `task_archive` | 归档完成的任务 |
| `task_list` | 列出所有 task |
| `task_search` | 搜索 task |

#### Worker 工具

| 工具 | 功能 |
|------|------|
| `worker_create` | 创建 worker 实例 |
| `worker_start` | 启动 worker 执行 |
| `worker_sendSignal` | 发送信号到 worker |
| `worker_cancel` | 取消后台执行的 worker |
| `worker_status` | 获取 worker 状态 |

#### Memory 工具

| 工具 | 功能 |
|------|------|
| `memory_get` | 从共享内存获取值 |
| `memory_set` | 向共享内存设置值 |
| `memory_keys` | 列出命名空间下的所有键 |
| `memory_has` | 检查键是否存在 |
| `memory_delete` | 删除键 |
| `memory_clear` | 清空命名空间 |
| `memory_save` | 保存共享内存到文件 |
| `memory_load` | 从文件加载共享内存 |

#### Auth 工具

| 工具 | 功能 |
|------|------|
| `auth_register` | 用户注册 |
| `auth_login` | 用户登录 |
| `auth_verify` | 验证 token |
| `auth_refresh` | 刷新 token |
| `auth_logout` | 用户登出 |

#### 其他工具

| 工具 | 功能 |
|------|------|
| `reference_architecture` | 查询架构类型参考 |
| `signal_emit` | 发送信号 |
| `signal_history` | 获取信号历史 |

## 开发全流程

```
用户需求
    │
    ▼
/explore → /design → /build → /check → /close
（探索）   （设计）   （实现）   （验收）   （收口）
```

## 目录结构

```
pi-dteam/
├── package.json        # 扩展包元数据
├── extensions/         # 扩展入口
├── src/                # 源代码
│   ├── extension/      # 扩展实现
│   ├── tools/          # 工具实现
│   ├── core/           # 核心模块
│   ├── P0/             # 原子层：配置定义
│   ├── P1/             # 基础层：服务实现
│   ├── P2/             # 组合层：模块实现
│   └── P3/             # 编排层：编排器
├── agents/             # agent 定义（5个）
├── prompts/            # prompt 模板（5个）
├── reference/          # 参考数据
├── .doc/               # 文档
├── tests/              # 测试
├── AGENTS.md           # Agent 行为规范
└── README.md           # 本文件
```

## 文档

- [文档导航](.doc/README.md)
- [Agent 行为规范](AGENTS.md)
- [系统注入提示词](reference/系统注入提示词.md)

## 许可证

MIT
