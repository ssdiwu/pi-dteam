# 修复 worker_create 参数序列化 bug

## 基本信息
- ID: 20260601181359-p0i2
- 类型: bugfix
- 创建时间: 2026-06-01T10:13:59.002Z
- 状态: todo

## 目标
- 为什么: dteam 的 worker_create 工具参数 schema 缺失导致 MCP/Pi 序列化层把 options 数组错误转成对象，阻塞所有 solo/team/chain 模式的 worker 执行
- 做什么: 修复 P4/index.ts 的 worker_create 参数 schema，显式定义 options 为 array 类型，解决 config.options?.find is not a function 错误

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）- [x] 修复 P4/index.ts 的 worker_create 参数 schema
- [x] 测试通过：80 tests passed
- [x] 构建成功：tsc 无错误
- [x] 工具测试：worker_create 和 worker_start 正常工作
- [x] Solo 模式：design 角色完整执行通过
- [x] Git commit：ae85cd8
- [x] 推送到 GitHub：main 分支

## 阶段记录### 探索发现

**问题现象**：
- 4 次不同写法的 worker_create + worker_start 都报 `config.options?.find is not a function`
- 从 worker_getMemory 拿到的实际 config 显示 `options: {item:[{type:role,value:design}]}`（应该是数组）

**根因分析**：
- P4/index.ts:432 的 parameters 声明只写了 `config: { type: "object" }`，没有定义 options 内部结构
- MCP/Pi 工具的 JSON 序列化层在处理未定义内部结构的 object 时，把数组错误地转成了对象
- 具体表现：`options: [...]` → `options: {item: [...]}`

**影响范围**：
- dteam 的 5 个 worker 工具（create/start/signal/cancel/status）全部受影响
- solo/team/chain 三种模式都跑不起来
- 这是一个 P0 级别的阻塞性 bug

### 讨论决策

**修复方案**：
在 P4/index.ts 的 worker_create 工具参数 schema 中正确定义 config 的内部结构，特别是 options 必须是 `type: "array"`。

**关键修复点**：
```typescript
options: {
    type: "array",  // ← 这是关键！之前缺失导致数组被转成对象
    items: {
        type: "object",
        properties: {
            type: { type: "string" },
            value: {},
        },
        required: ["type", "value"],
    },
},
```

### 执行记录

**修复时间**：2026-06-01 18:10
**修复文件**：src/P4/index.ts
**Git commit**：ae85cd8
**Git push**：已推送到 main 分支

**验证结果**：
- ✅ 测试通过：80 tests passed
- ✅ 构建成功：tsc 无错误
- ✅ 工具测试：worker_create 和 worker_start 正常工作
- ✅ Solo 模式：design 角色完整执行通过

### 收口记录

**修复原理**：
MCP/Pi 的 JSON 序列化层依赖 JSON Schema 的 `type` 字段来决定如何序列化。当 `config` 只声明为 `{ type: "object" }` 而没有定义 `options` 的内部结构时，序列化层无法识别 `options` 是数组，错误地将其转为 `{item: [...]}` 对象。显式声明 `type: "array"` 后，序列化层会正确保留数组结构。

**后续建议**：
1. 考虑在 P3 层添加参数验证和转换逻辑，做防御性编程
2. 参考 GitHub Issues #22394、#18260、#176，这是 MCP 工具生态的普遍问题
3. 可以考虑使用 Zod 或类似库做运行时类型检查

