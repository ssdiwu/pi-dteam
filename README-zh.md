# dteam

> Pi 扩展：让 Pi 干活时用便宜的小模型取证、探索带证据的技术候选和做机械活，你的强模型只管判断和收口——省 token、省时间。

## 这是什么

dteam 是 [Pi](https://github.com/earendil-works/pi-mono) 的一个扩展。装上之后，当主模型遇到非极小的代码任务（要读代码、查事实、探索技术路径、做改动、跑验证），它可以按 dteam 协议把取证、带证据的候选探测和机械活派给便宜、快速的小模型（T3），把结果汇报回来；需要更强能力时逐级升级到标准模型（T2）或旗舰模型（T1）。**你用的那个强模型始终负责理解任务、做决策、做最终验收**——它只是不再亲自去读每一个文件、跑每一个小检查。

一句话：**小模型干活，强模型判断。**

## 装了之后你会感受到什么

- 同样的任务，**花得更少、跑得更快**：读文件、找事实、探索带证据的技术候选和机械改动这些活交给了便宜模型，强模型的调用次数和 token 显著下降。
- 强模型**专注真正需要它的部分**：问题理解、方案决策、冲突裁决、关键验收。
- 你**不用手动选模型**：dteam 按任务需要自动路由档位；想细看或接管，用 `/dteam` 命令。

## 和 dgoal 的关系

dteam 和 [`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) 是两个独立的 Pi 扩展，正交可组合：

- **dteam**：多模型分级路由——让便宜模型干活、强模型判断。
- **dgoal**：单模型建检循环——给目标冻结验收契约、做独立审核。

需要省 token / 省时间用 dteam；需要冻结验收和独立审核用 dgoal；两者都要就组合。怎么选看[触发协议](./doc/10-架构与运行/14-dteam触发协议.md)。

## 快速上手

dteam 必须有个人配置文件，不按模型名猜档、也不静默回落当前模型。

```bash
# 1. 配置档位模型 ~/.pi/agent/pi-dteam.json：
# {
#   "tiers": {
#     "T1": ["openai-codex/gpt-5.6-terra:high"],
#     "T2": ["openai-codex/gpt-5.6-luna:medium"],
#     "T3": ["openai-codex/gpt-5.3-codex-spark:low"]
#   }
# }

# 2. 装到 Pi
pi install "$(pwd)"

# 3. 在 Pi 里 /reload

# 4. 让主模型干一个非极小的代码任务，观察它自动派 T3 取证
```

配置文件缺失或不完整时，dteam 会在启动时提醒并拒绝派发。每档是按顺序尝试的候选数组，格式 `provider/model[:thinking]`，后续项是回退模型。

## 档位

| 档位 | 模型 | 思考 | 用途 |
|---|---|---|---|
| **T1 旗舰** | 旗舰模型 | 高 | 思考、决策、关键验收、回退重做 |
| **T2 标准** | 标准模型 | 中 | 常规实现 |
| **T3 快速** | 快速 / 本地模型 | 低 | 机械小任务、取证探测 |

- 默认**只读**；任何写入都要在派发时显式 `addTools` 授权并声明项目相对 `writeScope`。
- 每个 worker 有初始工作工具调用额度（T3 60 / T2 120 / T1 180）；`dteam_signal` 与最终 `dteam_report` 不计入。

## 五个工具（主模型使用，你一般不用直接碰）

`dteam_dispatch`（派发）、`dteam_respond`（回应 worker 请求）、`dteam_control`（向运行中 worker 发送 steer、要求优雅停止或强制取消）、`dteam_recover`（超时恢复）、`dteam_wait`（等待 worker 事件）。`dteam_control` 不需要 `requestId`，不授予工具、不扩大 `writeScope`，只作用于 `running` worker。你可以用 `/dteam` 查看和管理后台 worker；在浮窗中按 `m` 编辑全局 T1/T2/T3 候选链，保存只影响后续派发。

## 深入

- [文档导航](./doc/README.md) —— 所有文档的入口
- [术语表](./doc/术语表.md)
- [工具 API 参考](./doc/10-架构与运行/12-API参考.md)
- [什么时候用 dteam vs dgoal](./doc/10-架构与运行/14-dteam触发协议.md)
- [项目路线图](./doc/30-路线图/30-项目路线图.md)
- [CHANGELOG](./CHANGELOG.md)

英文版：[README.md](./README.md)。
