# dteam 最小 5 角色定位

> 讨论稿，507 审阅后定稿。

## 现状：v0 的 6 角色

v0 归档前有 6 个 agent：explore / design / build / check / close / deploy

默认链：`explore → design → build → check → close`（deploy 可选）

## 蚁群的 4 角色

ant-colony 有 4 个 caste：

| 角色 | 工具 | 职责 |
|------|------|------|
| scout | read, bash, grep, find, ls | 侦察：快速扫描代码，收集情报 |
| worker | read, bash, edit, write, grep, find, ls | 执行：实际改代码 |
| soldier | read, bash, grep, find, ls | 审查：代码审查 + 验证 |
| drone | bash | 跑命令：纯 bash 执行，零 LLM 成本 |

## 对比

| 能力 | ant scout | ant worker | ant soldier | ant drone | dteam explore | dteam design | dteam build | dteam check | dteam close | dteam deploy |
|------|-----------|------------|-------------|-----------|---------------|--------------|-------------|-------------|-------------|--------------|
| 读代码 | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 改代码 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 跑命令 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 联网搜索 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 制定方案 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 写测试 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| 验收 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| 归档 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 独立思考 | 低 | 高 | 中 | 无 | 高 | 高 | 高 | 高 | 中 | 低 |

## 我的分析：5 个足够

去掉 deploy（v1 不需要独立部署角色），保留 5 个：

### 1. explore（探索者）= ant scout ↑

- **职责**：搜集内外部信息、识别风险、输出探索报告
- **工具**：read, grep, find, ls, bash, write, tinyfish_search, tinyfish_fetch
- **与 ant scout 的区别**：
  - ant scout 只看项目内部代码
  - dteam explore 额外能联网搜索（tinyfish）、能写探索报告
- **v1 定位**：brancher 的"眼睛"，只看不改

### 2. design（方案制定者）= ant 没有，dteam 独有

- **职责**：把需求转化为可执行方案 + 验收条件（GWT 格式）
- **工具**：read, grep, find, ls, bash, write
- **为什么 ant 没有**：ant 的 worker 自己判断怎么做；dteam 要求"先设计再动手"
- **v1 定位**：brancher 的"大脑"，出方案不出代码

### 3. build（实现者）= ant worker ↓

- **职责**：按方案写代码、更新文档、写测试
- **工具**：read, grep, find, ls, bash, edit, write
- **与 ant worker 的区别**：
  - ant worker 自己判断怎么做（maxTurns=15）
  - dteam build 严格按 design 的方案执行
  - ant worker 可以自由发挥；dteam build 不扩大 scope
- **v1 定位**：leaf 的"手"，唯一能改代码的角色

### 4. check（验收者）= ant soldier ↑

- **职责**：逐条验收 GWT 条件、检查代码质量、文档一致性
- **工具**：read, grep, find, ls, bash, write
- **与 ant soldier 的区别**：
  - ant soldier 做"代码审查"（偏主观）
  - dteam check 做"逐条验收"（偏客观，每条 PASS/FAIL）
- **v1 定位**：质量闸门，不通过不推进

### 5. close（收口者）= ant drone ↑（但不是 drone）

- **职责**：记录经验、整理归档、清理遗留、关闭任务
- **工具**：read, grep, find, ls, bash, write
- **与 ant drone 的区别**：
  - ant drone 是"纯 bash 跑命令"（1 turn，零思考）
  - dteam close 是"整理归档"（需要阅读、分析、总结）
- **v1 定位**：项目的"档案员"

## 去掉的角色

| 角色 | 去掉原因 |
|------|---------|
| deploy | v1 不需要独立部署角色。部署 = build 的最后几步 bash 命令。v2 再考虑 |

## 5 角色对应关系

```
ant-colony          dteam v1           本质差异
──────────          ──────────         ────────
scout       →      explore（↑增强）     加了联网搜索
（无）       →      design（独有）       先设计再动手
worker      →      build（↓收窄）       按方案执行，不自由发挥
soldier     →      check（↑增强）       逐条 GWT 验收
drone       →      close（重定义）      不是纯跑命令，是整理归档
```

## v1 怎么用这 5 角色

当前 v1 的 brancher 和 leaf 是"万能"的——每次都是同一个 LLM 干所有事。

v2 的进化路径：
1. **brancher.decide()** → 根据 task 特征选择角色
2. **leaf.execute()** → 用对应角色的 systemPrompt + tools 创建 session
3. 不同角色用不同模型（build 用 deepseek，explore 用 fast model）

但这是 v2 的事。**v1 的 brancher/leaf 不分角色，是万能的。**

## 开放问题（需要 507 拍板）

1. **5 个够不够？** 还是保留 6 个（加 deploy）？
2. **design 是否真的需要？** ant 没有 design 也跑通了——但 ant 的 worker 质量靠的是"多轮自由发挥"，dteam 的 build 是"按方案执行"，没有 design 就没有方案
3. **close 是否太轻？** 归档看起来不重要，但如果积累经验教训，长期价值很大
4. **角色和模型的关系？** 是否每个角色用不同模型（explore 用 fast model，build 用 reasoner）？
5. **角色工具权限？** build 是唯一能改代码的，这个要不要硬约束？
