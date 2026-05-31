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

### Compaction 本地化

dteam 内置了 Pi compaction 和 branch summary 输出的本地化功能。这意味着当你使用 `/compact` 或通过 `/tree` 导航分支时，总结的标题会自动翻译成你的语言。

**支持的语言：**

| Locale | 语言 | 标题示例 |
|--------|------|----------|
| `zh-CN` | 简体中文 | `## 目标 / ## 进展 / ## 下一步` |
| `zh-TW` | 繁體中文 | `## 目標 / ## 進展 / ## 下一步` |
| `ja` | 日本語 | `## 目標 / ## 進捗 / ## 次のステップ` |
| `ko` | 한국어 | `## 목표 / ## 진행 상황 / ## 다음 단계` |
| `de` | Deutsch | `## Ziel / ## Fortschritt / ## Nächste Schritte` |
| `fr` | Français | `## Objectif / ## Progression / ## Étapes suivantes` |
| `es` | Español | `## Objetivo / ## Progreso / ## Próximos pasos` |
| `pt` | Português | `## Objetivo / ## Progresso / ## Próximos passos` |
| `ru` | Русский | `## Цель / ## Прогресс / ## Следующие шаги` |
| `ar` | العربية | `## الهدف / ## التقدم / ## الخطوات التالية` |
| `en` | English | `## Goal / ## Progress / ## Next Steps` |

**检查状态：**

```
/compaction-i18n-status
```

语言会从你的环境变量自动检测（`PI_LOCALE` > `LC_ALL` > `LANG`）。

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
│   ├── P0/             # 原子层：类型、配置、纯函数
│   ├── P1/             # 分子层：服务实现
│   ├── P2/             # 细胞层：编排模式
│   ├── P3/             # 组织层：编排逻辑
│   └── P4/             # 用户接口层：Pi扩展入口
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
