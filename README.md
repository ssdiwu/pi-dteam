# pi-dteam

> 轻量级多代理编排系统 — 基于 Pi 的多代理工作流框架

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

```
task.create          # 创建新的 task
task.read            # 读取 task 的指定 section
task.update          # 更新 task 的指定 section
task.complete        # 标记 checklist 项为完成
task.archive         # 归档完成的任务
reference.architecture  # 查询架构类型参考
reference.thinking      # 查询思考方式参考
auth.register        # 用户注册
auth.login           # 用户登录
auth.verify          # 验证token
auth.refresh         # 刷新token
auth.logout          # 用户登出
```

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
dteam/
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
├── agents/             # agent定义（5个）
├── prompts/            # prompt模板（5个）
├── reference/          # 参考数据
├── .doc/               # 文档
├── tests/              # 测试
├── AGENTS.md           # Agent行为规范
└── README.md           # 本文件
```

## 文档

- [文档导航](.doc/README.md)
- [Agent行为规范](AGENTS.md)
- [系统注入提示词](reference/系统注入提示词.md)

## 许可证

MIT
