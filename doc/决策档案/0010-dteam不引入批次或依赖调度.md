# dteam 不引入批次或依赖调度

> **状态：✅ 有效，0.8 已实施**
>
> **承接**：ADR 0008 的模型分级路由与 ADR 0009 的会话级 Worker Manager（工作者管理器）。

## 决定

dteam 不引入 batch（批次）这一持久运行态、UI 概念或依赖图，也不承担依赖调度。`dteam` 必须能在**一次调用中受理一个或多个**显式 worker 请求；多个请求只是调用参数里的列表，不形成可追踪的 batch 对象。

主代理独占以下判断：理解依赖、决定哪些 worker 现在就绪、把哪些已就绪 worker 一次交给 dteam、等待哪些结果、结果后是派 worker、追加 dgoal task（任务）还是自己继续做。Worker Manager 只按每项请求管理档位路由、共享并发、后台生命周期、信号和结果回传；它不知道这些 worker 是否同属一次主代理拆解，更不会等待 A/B 后自动释放 C。

`dteam` 是唯一模型入口；其“一项或多项 worker 请求”的最终参数 schema（模式）随后确定。无论单项还是多项调用，返回值都只包含各自的 `workerId`，不产生 `batchId` 或 batch 完成态。

## dgoal 边界

dgoal task 是长程目标中的进度、证据和建检单位；dteam worker 是短生命周期的执行资源。两者**没有声明的对应关系**：一个 task 可不使用、使用一个或使用多个 worker；一个 worker 的产出也可只作为主代理判断的输入。dteam 不保存 dgoal 标识，dgoal 不保存 worker 标识，两个扩展均可单独运行。

`blockedBy` 位于 dgoal 的 Task Plan：当前实现校验依赖存在与无环、在 prompt/UI 展示关系，但不会自动阻止未就绪 task 进入 `in_progress`，更不会自动派 dteam worker。0.8 维持此语义；主代理才是依赖的解释者和执行时机的决定者。

## 为什么

主代理已经拥有任务上下文和依赖判断。让它一次把多个已就绪 worker 交给 dteam，减少多次 tool call（工具调用）开销，却不改变“谁是导演”。

反之，把“这些 worker 是一批”写成 dteam 状态，会继续长出批次状态、全批完成、批次依赖等 workflow 引擎形态；把依赖图交给 dteam，也会让它承担“等 A/B 后释放 C”的导演职责。
