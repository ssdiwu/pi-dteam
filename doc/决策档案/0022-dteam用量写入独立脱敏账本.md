# dteam 用量写入独立脱敏账本

> **状态：✅ 已实施**

## 决策

dteam worker 的模型用量写入独立的：

```text
~/.pi/agent/dteam-usage.jsonl
```

每条 worker assistant message（助手消息）在 `message_end` 时追加一条 v1 JSONL 记录。记录只包含父会话、项目、worker、请求档位、实际档位、candidate、模型、时间、纯数字 usage / cost 与 `dedupKey`；不保存 task、prompt、模型输出、工具参数、WorkerReport 或其他会话正文。

`pi-session-insights` 作为只读消费者按时间范围、worker、模型与实际档位去重聚合。账本是观测数据，不参与 worker 生命周期、恢复、路由或完成判定；写入失败只记录运行时 signal，不使业务任务失败。

## 原因

worker 使用 `SessionManager.inMemory()` 保持 fresh 与轻量隔离，Pi 的主会话 JSONL 不包含子 worker 的模型调用；只靠 session 扫描会漏算这部分真实 token 与费用。

不复用 `audit-usage.jsonl`：该文件现有语义是 pi-dgoal 独立审核的 phase / goal attempt，用 dgoal 的 scope 承载普通 dteam worker 会混淆审核次数、worker 回复和档位归属。独立账本让生产者、隐私边界与消费展示保持清楚。

不把 worker 改成持久化 Pi session：那会保存完整子任务上下文、污染 `/resume`，并扩大当前 Logical Isolation 的数据留存面。

## 权衡

- 每条 assistant message 都记录，因此失败、超时、同档 fallback 与恢复 attempt 的实际消耗不会因 worker 最终状态丢失。
- JSONL 是 append-only；`dedupKey` 包含时间与脱敏归属字段，供消费者防止重复行，不把不同回复错误合并。
- 文件创建及后续写入均收敛为 `0600`；记录仍属于本机敏感运行元数据，不应上传或进入模型上下文。
- dteam 不保证账本写入成功；磁盘错误不能改变 worker 的业务状态。
