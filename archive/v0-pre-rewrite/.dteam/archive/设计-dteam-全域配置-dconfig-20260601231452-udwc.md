# 设计-dteam-全域配置-dconfig

## 基本信息
- ID: 20260601231452-udwc
- 类型: infra
- 创建时间: 2026-06-01T15:14:52.359Z
- 状态: todo

## 目标
- 为什么: dteam 已有基础 dconfig 加载框架，需要讨论完整的配置项设计
- 做什么: 确定 dteam dconfig.json 的完整配置项，参考 dflow 的配置结构

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）- [x] AC1 dconfig.json 支持 `useCurrentModel` 布尔值，为 true 时跳过 models/fallbackModels 直接用 ctx.model
- [x] AC2 dconfig.json 配置写入全域配置 `~/.pi/agent/dteam/dconfig.json`
- [x] AC3 模型优先级：dconfig models → fallbackModels → ctx.model（useCurrentModel=false 时）
- [x] AC4 `npm test` 全部通过

## 阶段记录

### 探索发现

#### dflow dconfig 结构参考

```
~/.pi/agent/dflow/dconfig.json
```

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `models` | 角色→模型映射 | `{ "explore": "glm-5v-turbo" }` |
| `fallbackModels` | 角色→回退模型列表 | `{ "explore": ["glm-5.1", "mimo-v2.5"] }` |
| `dteam.maxSlots` | dteam 最大并发槽位 | `8` |
| `dteam.signalWindowSeconds` | 信号窗口秒数 | `300` |
| `drun.maxReviewLoops` | drun 最大审查轮次 | `3` |
| `drun.dteamThresholdFiles` | 触发 dteam 的文件阈值 | `3` |
| `drun.competitionThresholdFiles` | 竞争模式文件阈值 | `5` |
| `drun.competitionThresholdModules` | 竞争模式模块阈值 | `3` |
| `i18n.locale` | 国际化语言 | `"zh-Hans"` |
| `i18n.fallback` | 回退语言 | `"en"` |
| `compaction.enabled` | 是否启用 compaction i18n | `true` |
| `compaction.locale` | compaction 强制 locale | `""` |
| `compaction.model` | compaction 模型覆盖 | `""` |

#### dteam 当前已实现

- `models`：角色→模型映射 ✅
- `fallbackModels`：角色→回退模型列表 ✅
- 三层加载：内置 → 全域 → 项目 ✅

#### 待讨论

- dteam 特有配置项（如 maxSlots、signalWindowSeconds）
- 信号相关配置
- 信息素层配置
- spawn 配置
- 其他

### 讨论决策

#### 最终配置结构

```json
{
  "useCurrentModel": false,
  "models": {
    "explore": "mimo-v2.5-pro",
    "design": "mimo-v2.5-pro",
    "build": "mimo-v2.5-pro",
    "deploy": "mimo-v2.5",
    "check": "mimo-v2.5-pro",
    "close": "mimo-v2.5"
  },
  "fallbackModels": {
    "explore": ["MiniMax-M3", "glm-5v-turbo", "gpt-5.5"],
    "design": ["glm-5v-turbo", "MiniMax-M3", "gpt-5.5"],
    "build": ["MiniMax-M3", "glm-5v-turbo", "gpt-5.5"],
    "deploy": ["MiniMax-M3", "glm-5v-turbo", "gpt-5.5"],
    "check": ["gpt-5.5", "MiniMax-M3", "glm-5v-turbo"],
    "close": ["glm-5v-turbo", "MiniMax-M3", "gpt-5.5"]
  }
}
```

#### useCurrentModel 逻辑

| 值 | 行为 |
|----|------|
| `false`（默认） | 正常优先级：dconfig models → fallbackModels → ctx.model |
| `true` | 跳过 dconfig，直接用当前会话模型 |

#### 模型选择优先级

1. worker config 显式指定（用户调用工具时传的 model）
2. `useCurrentModel=true` 时直接用 ctx.model
3. dconfig `models.{role}`
4. dconfig `fallbackModels.{role}`
5. ctx.model（最终兜底）

#### 技术选型

- 复用 dflow 的三层配置加载模式（内置 → 全域 → 项目）
- `useCurrentModel` 放在顶层，简单直观
- fallbackModels 每个角色 3 个，够用不冗余

### 执行记录

- 新增 `src/P0/dteamConfig.ts`：三层配置加载（内置 → 全域 → 项目）。
- 更新 `src/P4/index.ts`：wrapWorker 支持 useCurrentModel + fallbackModels 注入。
- 写入 `~/.pi/agent/dteam/dconfig.json`：6 角色模型配置 + 3 个 fallback。
- 验证：`npm test` 通过，worker 能正常调用 LLM。

### 收口记录

- **经验教训**：配置系统应该像 dflow 一样简单——models + fallbackModels + useCurrentModel 三个字段就够用。
- **踩坑**：不应该在 models.json 里硬编码模型列表，应该用 dconfig.json 管理。
- **归档**：所有 AC 已完成，代码已 commit 并 push。

