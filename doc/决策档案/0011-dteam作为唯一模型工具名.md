# dteam 作为唯一模型工具名

> **状态：✅ 有效，0.8 已实施**
>
> **替代**：0.7 的模型工具名 `dteam_dispatch`；不改变扩展包名 `pi-dteam` 或用户命令 `/dteam`。

0.8 将唯一模型工具改名为 `dteam`。工具以 `type: "dispatch"` 接收一项或多项独立 worker 请求、以 `type: "respond"` 回应 waiting worker 的结构化请求；文档可简称 `dteam.dispatch` / `dteam.respond`，但 Pi 实际只注册一个工具。`/dteam` 专用于用户查看、接管和取消运行中 worker。

`dispatch` 只是 0.7 同步单 worker 形态留下的动作后缀。现在 dteam 同时承担后台 worker 生命周期、信号协作和多项启动，且唯一工具边界已经明确，保留后缀只制造“扩展名 / 工具名 / 动作名”三套不必要的叫法。

模型工具与 slash command（斜杠命令）由不同 Pi 注册入口承载；0.8 实施切片须补同名 `dteam` 工具与 `/dteam` 命令的加载回归测试。