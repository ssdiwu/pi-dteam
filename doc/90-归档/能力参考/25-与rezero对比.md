# 与 rezero 对比

> 调研记录。本节只做范式对比和"轻 / 重"评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](../../30-路线图/30-项目路线图.md)**。

- 来源：[https://pi.dev/packages/rezero](https://pi.dev/packages/rezero)
- v0.2.7，426.2 KB
- 124 下载/月
- 作者：juunini
- 借鉴参考：ant-colony

## 一句话

rezero 是个**多维评估 + git reset 重试**工作流，Re:Zero 动画梗化（Subaru 实现 → 七魔女评审 → Return by Death 重置）。`git reset --hard HEAD && git clean -fd` 回到干净状态重试。

## 核心机制

### 工作流

1. 给 Subaru 一个 trial（任务）
2. Subaru 实现
3. 七魔女多维评估（每个魔女用不同指标）
4. 不通过 → Return by Death（`git reset --hard HEAD && git clean -fd`）
5. 评估结果记录到 `.rezero/memory/subaru-deaths.md`
6. 重复直到通过

### 七魔女评估维度

| 魔女 | 评估维度 | 例子工具 |
|------|---------|---------|
| **Echidna** | Completeness, edge cases, coverage | SonarQube, coverage, Stryker |
| **Typhon** | Contracts, specifications, public interfaces | typecheck, linter, Spectral, Pact |
| **Minerva** | User harm, regressions, runtime failures | tests, Playwright, Lighthouse CI, k6 |
| **Daphne** | Dependency / resource consumption | OSV-Scanner, Knip, source-map-explorer, hyperfine |
| **Carmilla** | Deception in UI / docs / names / proofs | screenshots, axe, lychee |
| **Sekhmet** | Maintainability, dead code, duplication | SonarQube, Knip, jscpd |
| **Satella** | Integration, security, policy, consistency | CodeQL, Gitleaks, Trivy, CI |

每个魔女给出 verdict：`pass` / `warning` / `fail`。

### Rem 备忘录

过了主目标但有 warnings，warnings 记录到 `.rezero/memory/rem.md`（"Rem" 在原作里是 Subaru 的同伴）。

### Return by Death

```
git reset --hard HEAD
git clean -fd
```

**侵入式**：直接重置工作树。

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> **轻**：七魔女多维评估概念（设计层面）
> **重**：Return by Death（git reset 侵入）
> **重**：整个 rezero 工作流（426KB）
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。

### 借 1 个概念 ✅：dteam check 角色从 1 个扩到 7 个多维

- **当前**：dteam 有 1 个 `check` 角色（统一评估）
- **提议**：扩到 7 个 check 角色，每个对应一个评估维度
  - `check-completeness`（Echidna）
  - `check-contracts`（Typhon）
  - `check-user-harm`（Minerva）
  - `check-deps`（Daphne）
  - `check-deception`（Carmilla）
  - `check-maintainability`（Sekhmet）
  - `check-security`（Satella）

每个 check 角色是独立 worker，在 team 模式里跑（dteam 强项：chain/team 编排）。

**改动量**：
- `agents/` 目录下加 7 个 `.md`（每个 ~30 行 systemPrompt）
- `src/session/role-config.ts` 加 7 个 ROLE_DEFAULTS
- 路由分发：build 完成后用 team 模式并行跑 7 个 check
- **总改动量**：1~2 个文件（小到中）

### 不借 Return by Death ❌

- dteam 跑过不要回退
- `git reset --hard` 是侵入式，dteam 用户预期 dteam 是"派 worker 干活"，不是"反复重置"
- 失败时 dteam 当前行为：标记 step failed，chain 终止，保留已完成结果——足够

## 与 dteam 的关系

dteam 当前评估机制：
- 1 个 `check` 角色（系统提示词要求它做"code review"）
- `build_check` 策略：build → check → 修 → 再 check（最多 3 轮）
- 1 个 check 输出靠正则匹配 "通过/pass/✓" 判断

dteam 评估**只 1 个视角**（泛化的"code review"）。rezero 提示：**多维评估**更有保障。

但 dteam 也有自己的优势：
- check 角色可以看 build 输出（不只是 git diff）
- build_check 循环可以自动修（不用人工或另一个 agent）
- in-process 启动快

## 借鉴清单

| 项 | 范围 | 状态 | 备注 |
|----|------|------|------|
| 多维 check 角色（7 个） | 0.5.0~0.5.5 | 待定 | 借概念，dteam 自己实现 |
| Return by Death | — | 不做 | git reset 侵入，dteam 不需要 |
| 整套 rezero 工作流 | — | 不做 | 426KB，太重 |

## 不要学

- ❌ Return by Death（`git reset --hard` 侵入）
- ❌ 七魔女 verbiage（"Subaru"、"Rem"、"Return by Death" 等 Re:Zero 梗）
- ❌ `.rezero/memory/*.md` 落盘（dteam 不做持久化）
- ❌ BGM 播放（"Return by Death BGM"）
- ❌ 多语言 README（i18n 维护成本）
- ❌ 集成到 Claude Code / Codex（dteam 是 Pi 扩展，不跨平台）

## 关键不变量（dteam 必须保留）

1. **`check` 角色只 1 个**（除非显式扩展到多维）
2. **失败不重置**（`build_check` 失败时 chain 终止，保留已完成结果）
3. **不引入 git 侵入式操作**（dteam 跑过不重置）

## 参考实现位置

- npm 包：`rezero`
- GitHub：github.com/epsilondelta-ai/rezero
- 关键文件：扩展入口 `./extensions/`
- 七魔女定义：见 README "Seven Witches" 表
