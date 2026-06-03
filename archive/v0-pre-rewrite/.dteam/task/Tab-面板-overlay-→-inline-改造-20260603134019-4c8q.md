# Tab 面板 overlay → inline 改造

## 基本信息
- ID: 20260603134019-4c8q
- 类型: refactor
- 创建时间: 2026-06-03T05:40:19.587Z
- 状态: todo

## 目标
- **已完成（P0）**:
  - src/P4/worker-widget.ts: 删 OverlayHandle import；删 panelHandle/panelContainer；加 currentPanelDone；重写 closeWorkerPanel 走 done 回调；showWorkerPanel 主调用 + "no parent workers" 分支去掉 overlay 配置；resetExpandedState 同步清理
  - src/P4/README-worker-widget.md: "全屏覆盖层" → "inline widget" 描述
  - tests/P4/worker-widget.test.ts: 不改（mock 无 overlay 依赖），跑全量验证
- **新增（P1 — 本次修复）**:
  - src/P4/worker-widget.ts: 空态面板（"无 worker 正在工作"）加 Box 容器包裹
  - src/P4/worker-widget.ts: Tab 面板（多 worker 展开态）加 Box 容器包裹
  - src/P4/worker-widget.ts: 所有 `"─".repeat(N)` / `padEnd` 硬编码宽度改为动态 `w` 参数
  - src/P4/worker-widget.ts: `overlayOptions.width` 从 `"60%"` 字符串改为数字
  - npm test 全过 + build 无 type 错误


## 范围- src/P4/worker-widget.ts: 删 OverlayHandle import；删 panelHandle/panelContainer；加 currentPanelDone；重写 closeWorkerPanel 走 done 回调；showWorkerPanel 主调用 + "no parent workers" 分支去掉 overlay 配置；resetExpandedState 同步清理
- src/P4/README-worker-widget.md: "全屏覆盖层" → "inline widget" 描述
- tests/P4/worker-widget.test.ts: 不改（mock 无 overlay 依赖），跑全量验证
- npm test 验证 287+ tests 全过

## 验收条件（GWT + 测试）- [x] 删 OverlayHandle import
### P0 — inline 改造（已完成）
- [x] 删 OverlayHandle import
- [x] 删 panelHandle/panelContainer 模块状态
- [x] 加 currentPanelDone 关闭出口
- [x] closeWorkerPanel 改用 done(null) 关闭
- [x] showWorkerPanel 主调用去掉 overlay 参数
- [x] "no parent workers" 分支去掉 overlay 参数
- [x] resetExpandedState 同步清理 currentPanelDone
- [x] README-worker-widget.md 描述同步
- [x] npm test 全过
- [x] build 无 type 错误

### P1 — 面板渲染修复（本次已完成）
- [x] **AC-R1** 空态面板（无 worker）用 `Box` 组件包裹，`theme.bg("customMessageBg")` 不透明背景
- [x] **AC-R2** Tab 展开态面板（多 worker）用 `Box` 组件包裹，同上
- [x] **AC-R3** 所有分隔线 `"─".repeat(N)` 改为基于 `panelInnerW` 动态计算
- [x] **AC-R4** Tab 栏 title 的 `buildTabBar` 宽度参数改为动态 `panelInnerW`
- [x] **AC-R5** `overlayOptions.width` 从字符串 `"60%"` 改为数字 `60`/`80`
- [x] **AC-R6** Box 组件自适应宽度，窄终端不崩溃
- [x] **AC-R7** npm test 315/315 全过，无回归（补了 mock theme 的 `bg` 方法）
- [x] **AC-R8** npm run build 无 type 错误


## 阶段记录
### 探索发现
- **时间**: 2026-06-03 16:30（check agent 验收时发现）
- **触发**: 用户实测 `/dteam` 命令，截图反馈面板渲染异常
- **问题 1 — 透明穿透**: 空态面板直接用 `Container` + `Text` 拼内容，无 `Box` 容器包裹。overlay 虽然居中但透明，底层 Extensions/Prompts/Themes 列表透出来
- **问题 2 — 宽度溢出**: 分隔线 `"─".repeat(60/80)` 硬编码，终端宽度不足时文字溢出到右侧屏幕外。Tab 栏 title 的 `padEnd` 同样硬编码
- **问题 3 — overlay 参数**: 使用 `width: "60%"`（字符串百分比），官方示例用数字（如 `width: 40`）。且用 `void ctx.ui.custom()` 不 await

### 讨论决策
- **决策**: 在当前 task（4c8q）上追加 P1 修复范围，不复建新 task
- **方案**: 
  1. 引入 `Box` 组件替代裸 `Container`，提供视觉边界（`theme.bg("customMessageBg")` 不透明背景）
  2. 所有 render 函数内部基于参数动态计算宽度（`panelInnerW` 变量）
  3. overlayOptions 改为数字 width

### 执行记录
- **时间**: 2026-06-03 16:35-16:56
- **改动文件**:
  - `src/P4/worker-widget.ts`: 
    - 新增 `Box` import
    - 空态面板：`Container` → `Box(paddingX=2, paddingY=1, bg=customMessageBg)`；分隔线动态宽度；overlay width 改为数字 60
    - Tab 面板：`Container` → `Box`（同上配置）；`rebuild()` 内 `panelInnerW` 动态化；`buildTabBar/buildTabContent` 宽度参数动态化；新增 overlay 选项 `{ anchor: "center", width: 80, maxHeight: "70%" }`
    - `container` → `box` 全部引用同步（render/invalidate/dispose/clear/addChild）
  - `tests/P4/worker-panel.test.ts`: mock theme 补充 `bg` 方法
- **验证**: build ✅ tsc clean | test ✅ 315/315 passed

### 收口记录
- **结论**: P0 + P1 全部完成，19/19 AC PASS
- **遗留**: 无阻塞遗留
- **建议**: 可以归档


