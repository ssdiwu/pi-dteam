# dteam 扩展包开发规范

## 一、项目概述

### 项目定位

dteam 是一个 **Pi 扩展包项目**，提供轻量级的多代理编排能力。

### 核心概念

- **task**：工作主语对象（Markdown格式）
- **worker**：执行单元（solo/chain/team三种模式）
- **角色**：6个执行角色（explore/design/build/deploy/check/close）
- **信号**：即时通信机制（4个信号 + 5个策略 = 9种）
- **共享内存**：worker之间的数据共享机制（namespace隔离）
- **上下文构建器**：构建执行上下文的工具（ContextBuilder）
- **自定义执行器**：可注册的自定义执行逻辑（registerExecutor）

### 文档结构

```
.doc/
├── P0-原子层/        # task、信号类型、config、memory、status、i18n
├── P1-分子层/        # 角色、工具接口、信号总线、共享内存、TUI渲染层、i18n翻译
├── P2-细胞层/        # worker、solo/chain/team、信号总线
├── P3-组织层/        # 编排决策逻辑、worker编排层
├── P4-用户接口层/    # prompts定义
├── 治理/             # 决策记录
├── 研究/             # GSD借鉴、Superpowers借鉴
└── 规范/             # 术语与文风规范、文件布局规范
```

## 二、开发流程

### 1. 先读后写

- 先看文件、搜索现状、确认上下文，再做判断或改动
- 能从代码库、定义文件读出的信息，不重复向用户索取

### 2. 文档优先

- 修改代码前，先更新对应的文档
- 确保代码和文档的一致性

### 3. 测试验证

- 修改代码后，运行测试验证
- 确保不破坏现有功能

## 三、代码规范

### 1. 文件命名

- TypeScript 文件：小驼峰（`taskManager.ts`）
- 定义文件：大驼峰（`TaskManager.ts`）
- 测试文件：`*.test.ts` 或 `*.spec.ts`

### 2. 代码风格

- 使用 TypeScript 严格模式
- 遵循项目现有的代码风格
- 使用有意义的变量名
- 函数控制在 50 行以内

### 3. 注释规范

- 使用 JSDoc 注释
- 复杂逻辑处添加解释性注释
- 不要添加无意义的注释

## 四、文档规范

### 1. 文档结构

- 每个文档必须有 frontmatter
- 使用 Markdown 格式
- 使用中文撰写
- 技术术语使用英文

### 2. Frontmatter 格式

```yaml
---
title: "文档标题"
kind: definition
domain: P0-原子层
status: stable
tags: [标签1, 标签2]
created: 2026-05-29
updated: 2026-05-29
---
```

### 3. 依赖关系

- P0-原子层：不依赖其他
- P1-分子层：依赖P0
- P2-细胞层：依赖P1
- P3-组织层：依赖P2
- P4-用户接口层：依赖P3

## 五、测试规范

### 1. 测试文件位置

```
tests/
└── unit/           # 单元测试
```

### 2. 测试命名

- 测试文件：`*.test.ts` 或 `*.spec.ts`
- 测试用例：描述性的名称，说明测试场景

### 3. 测试覆盖

- 正常路径
- 边界情况
- 错误情况

### 4. 测试命令

```bash
npm test            # 运行所有测试
npm run test:watch  # 监听模式
```

## 六、Git 规范

### 1. 提交信息

遵循 Conventional Commits 格式：

```
type(scope): 描述

[可选正文]
```

类型：feat, fix, refactor, docs, test, chore, perf, ci, style, build

### 2. 分支策略

- main：主分支
- develop：开发分支
- feature/*：功能分支
- fix/*：修复分支

### 3. 提交前检查

- 运行测试：`npm test`
- 检查 TypeScript：`npm run build`

## 七、扩展包规范

### 1. 目录结构

```
dteam/
├── agents/             # 角色定义（explore/design/build/deploy/check/close）
├── prompts/            # worker启动器
├── reference/          # 结构化数据
├── src/                # 源代码
│   ├── P0/             # 原子层实现
│   ├── P1/             # 分子层实现
│   ├── P2/             # 细胞层实现
│   ├── P3/             # 组织层实现
│   ├── core/           # 核心模块
│   ├── extension/      # 扩展模块
│   └── tools/          # 工具实现
├── tests/              # 测试
├── .doc/               # 文档
├── .dteam/             # dteam配置
├── .pi/                # Pi配置
├── AGENTS.md           # 本文件
└── package.json        # 项目配置
```

### 2. package.json

```json
{
  "name": "pi-dteam",
  "version": "0.1.0",
  "description": "dteam - 轻量级多代理编排系统",
  "type": "module",
  "pi": {
    "extensions": ["./extensions"],
    "prompts": ["./prompts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "^0.75.5"
  },
  "dependencies": {
    "@earendil-works/pi-tui": "^0.74.2"
  }
}
```

### 3. 注册扩展

- extensions：扩展代码
- prompts：prompt模板

## 八、常见问题

### 1. 如何新增 prompt？

1. 在 `prompts/` 目录下创建 `.md` 文件
2. 添加 frontmatter（description、argument-hint）
3. 在 `.doc/P4-用户接口层/prompts.md` 中添加定义

### 2. 如何新增工具？

1. 在 `src/tools/` 目录下创建工具实现
2. 在 `.doc/P1-分子层/工具接口.md` 中添加定义
3. 更新 AGENTS.md 中的工具列表

### 3. 如何新增角色？

1. 在 `agents/` 目录下创建角色定义
2. 在 `.doc/P1-分子层/` 目录下创建角色文档
3. 更新 `.doc/P1-分子层/角色.md` 中的角色列表

### 4. 如何新增信号类型？

1. 在 `src/core/signalBus.ts` 中添加信号类型
2. 在 `.doc/P0-原子层/信号类型.md` 中添加定义
3. 更新相关文档中的信号类型引用
