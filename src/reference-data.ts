/**
 * dteam v1 — 架构模式参考库 + reference_architecture 工具
 *
 * 12 个经典架构模式 + ADR 草稿模板。
 * 仅供 design 角色使用（通过 customTools 注入）。
 */

import type { ArchitecturePattern } from "./tools.js";

// ═══ 模式数据 ═══

const PATTERNS: ArchitecturePattern[] = [
  {
    name: "monolith",
    category: "monolith",
    description: "单体架构——所有功能在一个部署单元内，共享数据库和进程。",
    pros: ["开发部署简单", "事务一致性容易保证", "调试和追踪方便", "无网络序列化开销"],
    cons: ["扩展性受限于单进程", "技术栈锁定", "代码库膨胀后维护难", "故障影响全局"],
    bestFor: ["MVP / 小团队", "单一业务域", "内部工具"],
    worstFor: ["大规模并发", "多团队协作", "需要独立伸缩的模块"],
    adrTemplate: `# ADR-XXX: 采用单体架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
采用单体架构，所有功能部署在一个进程中。

## 理由
- 团队规模小，单体开发效率最高
- 业务域单一，无独立扩展需求

## 后果
### 正面
- 开发部署流程简单
- 事务一致性容易

### 负面
- 后续规模增长可能需要拆分

## 备选方案
- 模块化单体
- 微服务`,
  },
  {
    name: "microservices",
    category: "microservices",
    description: "微服务架构——按业务能力拆分为独立部署的服务，各自拥有数据存储。",
    pros: ["独立部署和扩展", "技术栈可异构", "故障隔离", "团队可独立迭代"],
    cons: ["分布式系统复杂性", "网络延迟和可靠性", "数据一致性难保证", "运维和监控成本高"],
    bestFor: ["多团队协作", "大规模系统", "需要独立伸缩的模块"],
    worstFor: ["小团队 / MVP", "强事务需求", "低延迟要求"],
    adrTemplate: `# ADR-XXX: 采用微服务架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
按业务能力拆分为独立部署的微服务。

## 理由
- 团队按业务域分工，需要独立迭代
- 不同模块有不同的扩展需求

## 后果
### 正面
- 独立部署和扩展
- 故障隔离

### 负面
- 分布式事务和数据一致性复杂
- 运维成本增加

## 备选方案
- 模块化单体
- 事件驱动架构`,
  },
  {
    name: "layered",
    category: "layered",
    description: "分层架构——按职责分为表示层、业务层、数据层，单向依赖。",
    pros: ["职责分离清晰", "每层可独立测试", "学习成本低", "广泛理解和实践"],
    cons: ["严格分层可能过度抽象", "性能有层间开销", "容易退化为'大泥球'"],
    bestFor: ["企业应用", "CRUD 为主的应用", "团队对分层模式熟悉"],
    worstFor: ["高性能低延迟场景", "复杂领域模型"],
    adrTemplate: `# ADR-XXX: 采用分层架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
按表示层→业务层→数据层分层，单向依赖。

## 理由
- 团队熟悉分层模式
- 业务以 CRUD 为主

## 后果
### 正面
- 职责分离，便于维护

### 负面
- 需要防止层间越权

## 备选方案
- 六边形架构
- 洋葱架构`,
  },
  {
    name: "hexagonal",
    category: "hexagonal",
    description: "六边形架构（端口与适配器）——核心业务逻辑与外部世界隔离，通过端口抽象交互。",
    pros: ["核心逻辑不依赖框架", "易于替换外部组件", "测试性好", "DDD 友好"],
    cons: ["抽象层多，入门门槛高", "小项目可能过度设计", "适配器代码量大"],
    bestFor: ["复杂业务域", "需要长期演进的系统", "DDD 项目"],
    worstFor: ["简单 CRUD", "短期项目"],
    adrTemplate: `# ADR-XXX: 采用六边形架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
采用端口与适配器模式，核心业务逻辑与基础设施隔离。

## 理由
- 业务逻辑复杂，需要保护核心域
- 需要支持多种外部接口

## 后果
### 正面
- 核心逻辑可独立测试
- 外部组件可替换

### 负面
- 适配器代码量增加

## 备选方案
- 分层架构
- 洋葱架构`,
  },
  {
    name: "event-driven",
    category: "event-driven",
    description: "事件驱动架构——组件通过异步事件通信，解耦生产者和消费者。",
    pros: ["高度解耦", "异步处理提高吞吐", "易于扩展消费者", "天然事件溯源友好"],
    cons: ["调试和追踪困难", "最终一致性复杂", "事件 schema 演进难", "消息丢失风险"],
    bestFor: ["实时数据处理", "需要松耦合的系统", "事件溯源场景"],
    worstFor: ["强一致性要求", "简单同步请求-响应"],
    adrTemplate: `# ADR-XXX: 采用事件驱动架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
组件通过异步事件通信，解耦生产者和消费者。

## 理由
- 系统需要高度解耦
- 有大量异步数据处理需求

## 后果
### 正面
- 组件可独立演进
- 异步处理提高吞吐

### 负面
- 调试和追踪复杂
- 最终一致性需要额外处理

## 备选方案
- 微服务（同步 API）
- CQRS`,
  },
  {
    name: "cqrs",
    category: "cqrs",
    description: "CQRS（命令查询职责分离）——写入和读取使用不同的模型，优化各自的性能和复杂度。",
    pros: ["读写各自优化", "适合复杂业务规则", "与事件溯源天然配合", "查询性能独立扩展"],
    cons: ["数据同步复杂", "代码量翻倍", "最终一致性", "学习成本高"],
    bestFor: ["读写负载差异大的系统", "复杂业务规则", "事件溯源"],
    worstFor: ["简单 CRUD", "小规模系统"],
    adrTemplate: `# ADR-XXX: 采用 CQRS

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
分离写入（Command）和读取（Query）模型。

## 理由
- 写入和读取的负载模式差异大
- 写入需要复杂业务规则，读取需要高性能

## 后果
### 正面
- 读写各自优化

### 负面
- 数据同步需要额外处理

## 备选方案
- 事件驱动架构
- 分层架构`,
  },
  {
    name: "serverless",
    category: "serverless",
    description: "无服务器架构——以函数为单位部署，按调用计费，基础设施完全托管。",
    pros: ["按使用付费", "自动伸缩", "无需管理服务器", "快速上线"],
    cons: ["冷启动延迟", "执行时间限制", "厂商锁定", "调试和本地测试复杂"],
    bestFor: ["事件驱动处理", "流量波动大的 API", "低成本原型"],
    worstFor: ["长时间运行任务", "低延迟要求", "复杂有状态服务"],
    adrTemplate: `# ADR-XXX: 采用无服务器架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
采用函数即服务（FaaS）模式部署业务逻辑。

## 理由
- 流量波动大，按使用付费更经济
- 不希望管理基础设施

## 后果
### 正面
- 自动伸缩，按使用付费

### 负面
- 冷启动延迟
- 厂商锁定风险

## 备选方案
- 容器化部署
- 微服务`,
  },
  {
    name: "microkernel",
    category: "microkernel",
    description: "微内核架构——最小核心系统 + 可插拔插件/功能模块，核心不依赖插件。",
    pros: ["扩展性好", "核心稳定", "插件可独立开发", "按需加载功能"],
    cons: ["插件 API 设计困难", "插件间交互复杂", "核心设计需要前瞻性", "版本兼容性管理"],
    bestFor: ["IDE / 编辑器", "企业应用（按需功能）", "平台型产品"],
    worstFor: ["功能固定的系统", "高性能计算"],
    adrTemplate: `# ADR-XXX: 采用微内核架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
最小核心系统 + 可插拔功能模块。

## 理由
- 需要支持多种可选功能
- 核心必须保持稳定

## 后果
### 正面
- 扩展性好，按需加载

### 负面
- 插件 API 设计需要前瞻性

## 备选方案
- 模块化单体
- 管道-过滤器`,
  },
  {
    name: "pipe-filter",
    category: "pipe-filter",
    description: "管道-过滤器架构——数据流过一系列独立处理阶段，每个阶段（过滤器）独立且可复用。",
    pros: ["过滤器可复用", "易于组合新流程", "每个过滤器独立测试", "并发处理友好"],
    cons: ["数据转换开销", "不适合交互式应用", "错误处理复杂", "共享状态困难"],
    bestFor: ["数据流水线", "ETL 处理", "编译器"],
    worstFor: ["交互式 UI 应用", "强事务需求"],
    adrTemplate: `# ADR-XXX: 采用管道-过滤器架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
数据流过一系列独立过滤器，管道连接各阶段。

## 理由
- 数据处理有明确的多阶段流程
- 各阶段需要独立开发和测试

## 后果
### 正面
- 过滤器可复用和独立测试

### 负面
- 不适合需要共享状态的场景

## 备选方案
- 微内核
- 事件驱动`,
  },
  {
    name: "space-based",
    category: "space-based",
    description: "空间架构——内存数据网格为核心，弹性伸缩通过复制数据分片实现，避免数据库瓶颈。",
    pros: ["极高并发", "弹性伸缩", "避免数据库瓶颈", "低延迟"],
    cons: ["数据一致性复杂", "内存成本高", "复杂度高", "数据丢失风险"],
    bestFor: ["超高并发场景", "实时竞价", "社交互动"],
    worstFor: ["数据量极大且需要持久化", "简单应用"],
    adrTemplate: `# ADR-XXX: 采用空间架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
以内存数据网格为核心，弹性伸缩。

## 理由
- 并发量极高，数据库成为瓶颈
- 需要低延迟响应

## 后果
### 正面
- 极高并发和低延迟

### 负面
- 数据一致性需要额外处理
- 基础设施成本高

## 备选方案
- 事件驱动架构
- CQRS`,
  },
  {
    name: "client-server",
    category: "client-server",
    description: "客户端-服务器架构——请求-响应模型，服务器集中管理资源，客户端负责交互。",
    pros: ["集中管理", "安全性易控制", "标准化（HTTP/RPC）", "部署简单"],
    cons: ["服务器单点故障", "水平扩展受限", "网络延迟", "客户端离线不可用"],
    bestFor: ["Web 应用", "移动应用后端", "企业内部系统"],
    worstFor: ["对等协作", "离线优先应用"],
    adrTemplate: `# ADR-XXX: 采用客户端-服务器架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
客户端发起请求，服务器集中处理和存储。

## 理由
- 需要集中管理数据和权限
- 标准化通信协议成熟

## 后果
### 正面
- 集中管理，安全性好

### 负面
- 服务器单点故障风险

## 备选方案
- P2P
- 无服务器`,
  },
  {
    name: "peer-to-peer",
    category: "peer-to-peer",
    description: "对等网络架构——无中心节点，每个节点既是客户端也是服务器。",
    pros: ["无单点故障", "天然扩展", "去中心化", "抗审查"],
    cons: ["数据一致性难", "安全性难保证", "调试困难", "节点质量参差"],
    bestFor: ["文件共享", "区块链", "即时通讯"],
    worstFor: ["需要中心化控制", "强一致性要求"],
    adrTemplate: `# ADR-XXX: 采用 P2P 架构

## 状态
提议

## 背景
<描述业务场景和约束>

## 决策
无中心节点，每个节点地位平等。

## 理由
- 需要去中心化
- 天然扩展性要求

## 后果
### 正面
- 无单点故障
- 天然弹性

### 负面
- 数据一致性难保证
- 安全性挑战

## 备选方案
- 客户端-服务器
- 事件驱动`,
  },
];

// ═══ 格式化输出 ═══

function formatPattern(p: ArchitecturePattern): string {
  return [
    `## ${p.name} (${p.category})`,
    "",
    p.description,
    "",
    "**优点**:",
    ...p.pros.map(x => `- ${x}`),
    "",
    "**缺点**:",
    ...p.cons.map(x => `- ${x}`),
    "",
    "**适用**:",
    ...p.bestFor.map(x => `- ${x}`),
    "",
    "**不适用**:",
    ...p.worstFor.map(x => `- ${x}`),
    "",
    "---",
    "### ADR 草稿模板",
    "",
    p.adrTemplate.trim(),
  ].join("\n");
}

// ═══ 导出工具 ═══

export const referenceArchitectureTool = {
  name: "reference_architecture",
  label: "Architecture Reference",
  description:
    "查询通用软件架构模式（用于 design 阶段选型）。返回模式描述、优缺点、适用场景 + ADR 草稿模板。" +
    "不传 pattern 返回全部 12 个模式的概要。",
  parameters: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string" as const,
        description: "架构模式关键词（部分匹配 name 或 category），不传则返回全部",
      },
    },
  },
  async execute(
    _toolCallId: string,
    params: { pattern?: string },
    _signal: any,
    _onUpdate: any,
    _ctx: any,
  ) {
    const query = (params.pattern ?? "").toLowerCase().trim();
    const matched = query
      ? PATTERNS.filter(
          p => p.name.includes(query) || p.category.includes(query),
        )
      : PATTERNS;

    if (matched.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `未找到匹配 "${params.pattern}" 的架构模式。可用模式：${PATTERNS.map(p => p.name).join(", ")}`,
        }],
      };
    }

    const text = matched.map(formatPattern).join("\n\n---\n\n");
    return { content: [{ type: "text" as const, text }] };
  },
};
