# tui/

`/dteam` 的按需管理视图。只消费 Worker Snapshot，不拥有 worker 生命周期；运行中记录可查看，终态记录只读。列表以“运行中 / 历史记录”分视图呈现，默认运行中，左右方向键或 `h/l` 切换；历史按终态时间倒序显示。详情以 worker ID 保持目标，即使 worker 在查看时终态化也会封存显示；无 `ui.custom()` 时降级为同时输出两个视图。列表和详情使用有界视口，支持方向键、`j/k`、`PgUp/PgDn`、`Home/End` 浏览，避免 worker 堆积被 Modal 裁切。详情展示有界实时文本、thinking、当前工具、最后活动与 timeout 诊断，刷新由运行时节流。`dteam-dialog.ts` 使用有包边的 Modal 和 `i18n.ts` 的 `pi.i18n.v1` bundle；默认中文，接入 `pi-di18n` 后按 locale 切换。
