# tui/

`/dteam` 的按需管理视图。只消费 Worker Snapshot，不拥有 worker 生命周期；运行中记录可查看，终态记录只读。`dteam-dialog.ts` 使用有包边的 Modal 和 `i18n.ts` 的 `pi.i18n.v1` bundle；默认中文，接入 `pi-di18n` 后按 locale 切换。
