# 与 pi-roadmap 对比

> 调研记录。本节只做范式对比和"轻 / 重"评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](../../30-路线图/30-项目路线图.md)**。

- 来源：[https://pi.dev/packages/pi-roadmap](https://pi.dev/packages/pi-roadmap)
- v1.1.1，156.1 KB
- 277 下载/月
- 作者：lain-residue（npm: catlain）
- 借鉴参考：ant-colony、`/Users/diwu/.pi/agent/extensions-backup/ant-colony.disabled/`

## 一句话

pi-roadmap 是个**项目管理工具**：Epic → Story → Task 三层结构 + priority 继承 + 状态级联 + 跨 session 进度跟踪。给"人管项目"用的。

## 核心机制

### 数据模型

```
Roadmap
└── Epic E0 [high]              ← 映射到一个项目目录
    ├── Story E0.S0 [doing]
    │   ├── ✅ T0: Design schema    [done]
    │   ├── 🔄 T1: Implement storage [doing]
    │   └── ⬜ T2: Write tests      [todo]
    └── Story E0.S1 [todo]
        └── ⬜ T0: ...             [todo]
```

- Priority 继承：task > story > epic > "medium"
- Status 级联：所有 task done → story 自动 done；所有 story done → epic 自动 done
- 状态机：todo → doing → done | blocked | dropped

### 存储

- 全局：`~/.pi/roadmap/<id>.roadmap.json`
- 项目级：`<project>/.pi/roadmap/roadmap.json`（过滤视图）
- Archive：`~/.pi/roadmap/archive/<id>.roadmap.json`
- Doing：`~/.pi/roadmap/doing.json`（session 结束提醒）

### 5 个工具

| 工具 | 用途 |
|------|------|
| `roadmap_list` | 列出所有 roadmap + 进度条 + 过滤 |
| `roadmap_show` | 展示完整 roadmap 树 |
| `roadmap_plan` | 创建/更新 roadmap（接收 JSON） |
| `roadmap_next` | 拿下一个 actionable task（高优先级优先） |
| `roadmap_done` | 标记 task 完成 + 级联状态 |

### 限制

- ID 手动 zero-indexed 分配
- `done` 任务不可撤销
- 无并发控制（单 agent 写）
- 无 due date（只按 priority 排序）

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> **轻**：Epic/Story/Task 三层结构（设计概念）
> **重**：完整 5 工具 + 持久化 + 级联（集成实现）
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。

## 与 dteam 的关系

dteam 当前有 `30-路线图/30-项目路线图.md`（markdown 表格，单文件）。这是 dteam 自己的**演进计划**（dteam 下个版本做什么）。

pi-roadmap 是给**人管项目**用的——任何项目能用。两个工具**用途不重叠**：
- pi-roadmap：人管项目（"我的项目接下来做什么"）
- dteam 路线图：dteam 自己的演进（"dteam 下个版本做什么"）

## 借鉴价值

pi-roadmap 真正值得借鉴的**只有 1 个概念**：

✅ **Epic/Story/Task 三层结构**（比 dteam 当前 2 维表多一层粒度）

**不要直接借**：
- ❌ 5 工具 + JSON 存储（dteam 路线图是只读单文件，集成 5 工具是 over-engineering）
- ❌ 状态级联 / priority 继承（dteam 路线图由人手维护，不需要自动级联）
- ❌ archive / doing 子系统（dteam 用 git 管理版本）

## 借鉴方式（**待定**）

507 还没拍板，先列 3 个候选。

### 方式 A：dteam 集成 pi-roadmap 作为 dteam 的"内部路线图工具"

- dteam 暴露 5 个工具（list/show/plan/next/done）给 LLM
- 存储在 `~/.pi/roadmap/dteam.roadmap.json`
- **优点**：LLM 能用工具更新路线图，避免人手改 markdown
- **缺点**：dteam 变重（多 5 个工具 + 156KB 依赖）——**违反轻量化**

### 方式 B：借 Epic/Story/Task 三层结构，dteam 路线图升级

- dteam 路线图从 2 维表 → Epic/Story/Task 三层（仍 markdown）
- **优点**：路线图更有粒度
- **缺点**：路线图变复杂，三层结构可能过重（dteam 路线图是单文件 markdown 简单维护）

### 方式 C：507 自己用 pi-roadmap 管 dteam 演进（dteam 自身不集成）

- 507 装 pi-roadmap 在自己 Pi 上
- dteam 自己的 `30-路线图/30-项目路线图.md` 保留（轻量）
- **优点**：dteam 保持轻量；507 用专业工具管项目
- **缺点**：两个路线图（pi-roadmap + dteam markdown）可能不同步

**我推荐 C**：
- pi-roadmap 是"人管项目"，dteam 是"派 worker 干活"——两件事不重叠
- A 让 dteam 背 156KB 依赖，违反轻量化
- B 让 dteam 路线图变复杂
- C 让你用专业工具管项目，dteam 保持极简

**待 507 状态好时拍板。**

## 不要学

- ❌ 5 个工具全部集成（dteam 自己暴露 1 个工具，集成 5 个违反 dteam 哲学）
- ❌ 状态级联（dteam 路线图是只读表，由人手维护）
- ❌ 跨项目 sync（dteam 路线图是单文件，不跨项目）
- ❌ archive / doing 子系统（dteam 用 git 管理版本）

## 关键不变量（dteam 必须保留）

不管借鉴什么：

1. **dteam 路线图单文件 markdown**（`30-路线图/30-项目路线图.md`）—— 轻量、可读、人手维护
2. **dteam 工具表只暴露 1 个**（`dteam`）—— 不增加 `roadmap_*` 工具

## 参考实现位置

- npm 包：`pi-roadmap`
- GitHub：github.com/catlain/pi-roadmap
- 关键文件：`index.ts` + `lib/store.ts` + `lib/progress.ts`
