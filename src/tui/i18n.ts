import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

type I18nBundleV1 = {
  version: 1;
  namespace: string;
  locale: string;
  integration: { capability: "pi.i18n.v1"; provider: string };
  messages: Record<string, string>;
};

type I18nApiLike = {
  t: (key: string, params?: Record<string, string | number>) => string;
  registerBundle?: (bundle: I18nBundleV1) => unknown;
};

type I18nRequestPayload = { reply?: (api: I18nApiLike) => void };

const I18N_NAMESPACE = "dteam";

const I18N_BUNDLES: I18nBundleV1[] = [
  {
    version: 1,
    namespace: I18N_NAMESPACE,
    locale: "zh-CN",
    integration: { capability: "pi.i18n.v1", provider: "pi-dteam" },
    messages: {
      "dialog.listTitle": "dteam 工作列表",
      "dialog.detailTitle": "dteam / {title}",
      "dialog.count": "此视图 {count} 个 worker · 共 {active} 个运行中",
      "dialog.tabActive": "运行中 ({count})",
      "dialog.tabHistory": "历史记录 ({count})",
      "dialog.noActiveWorkers": "当前没有运行中的 worker。",
      "dialog.noHistoryWorkers": "暂无历史 worker。",
      "dialog.range": "{start}-{end}/{total}",
      "dialog.compactTool": "工具 {value}",
      "dialog.untitled": "未命名 worker",
      "dialog.noTask": "无任务描述",
      "dialog.task": "任务：{value}",
      "dialog.finding": "发现：{value}",
      "dialog.error": "错误：{value}",
      "dialog.id": "编号：{value}",
      "dialog.state": "状态：{value}",
      "dialog.tier": "档位：{value}",
      "dialog.elapsed": "耗时：{value}",
      "dialog.tools": "工具：{value}",
      "dialog.fallback": "回退：{value}",
      "dialog.result": "结果：{value}",
      "dialog.liveText": "实时输出：{value}",
      "dialog.liveThinking": "思考：{value}",
      "dialog.liveTool": "当前工具：{value}",
      "dialog.lastActivity": "最后活动：{value}",
      "dialog.timeout": "超时诊断：attempt {attemptBudget} / recovery {maxBudget} / 已运行 {elapsed}；最后活动：{lastActivity}；当前工具：{currentTool}",
      "dialog.timeoutOutput": "已有输出：{value}",
      "dialog.none": "无",
      "dialog.controls.list": "←/→ 或 h/l 切换 · ↑/↓ 或 j/k 选择 · PgUp/PgDn、Home/End 跳转 · Enter 查看详情 · Esc 关闭",
      "dialog.controls.running": "↑/↓ 或 j/k 浏览 · s 接管 · c 取消（需确认） · Esc 返回",
      "dialog.controls.archive": "↑/↓ 或 j/k 浏览 · 只读封存 · Esc 返回",
      "status.active": "{count} 个 worker 运行中",
      "state.queued": "排队中",
      "state.running": "运行中",
      "state.waiting": "等待回应",
      "state.completed": "已完成",
      "state.failed": "失败",
      "state.timed_out": "已超时",
      "state.cancelled": "已取消",
      "state.shutdown": "已关闭",
      "steering.title": "接管 worker",
      "steering.placeholder": "给 worker 的插队指令",
      "cancel.title": "取消 worker",
      "cancel.message": "确认取消 worker「{title}」？",
    },
  },
  {
    version: 1,
    namespace: I18N_NAMESPACE,
    locale: "en",
    integration: { capability: "pi.i18n.v1", provider: "pi-dteam" },
    messages: {
      "dialog.listTitle": "dteam workers",
      "dialog.detailTitle": "dteam / {title}",
      "dialog.count": "{count} worker(s) in this view · {active} active total",
      "dialog.tabActive": "Active ({count})",
      "dialog.tabHistory": "History ({count})",
      "dialog.noActiveWorkers": "No active workers.",
      "dialog.noHistoryWorkers": "No worker history yet.",
      "dialog.range": "{start}-{end}/{total}",
      "dialog.compactTool": "tool {value}",
      "dialog.untitled": "untitled worker",
      "dialog.noTask": "no task description",
      "dialog.task": "task: {value}",
      "dialog.finding": "finding: {value}",
      "dialog.error": "error: {value}",
      "dialog.id": "id: {value}",
      "dialog.state": "state: {value}",
      "dialog.tier": "tier: {value}",
      "dialog.elapsed": "elapsed: {value}",
      "dialog.tools": "tools: {value}",
      "dialog.fallback": "fallback: {value}",
      "dialog.result": "result: {value}",
      "dialog.liveText": "live: {value}",
      "dialog.liveThinking": "thinking: {value}",
      "dialog.liveTool": "tool: {value}",
      "dialog.lastActivity": "last activity: {value}",
      "dialog.timeout": "timeout: attempt {attemptBudget} / recovery {maxBudget} / elapsed {elapsed}; last: {lastActivity}; tool: {currentTool}",
      "dialog.timeoutOutput": "output: {value}",
      "dialog.none": "none",
      "dialog.controls.list": "←/→ or h/l switch · ↑/↓ or j/k select · PgUp/PgDn, Home/End jump · Enter details · Esc close",
      "dialog.controls.running": "↑/↓ or j/k browse · s steer · c cancel (confirm) · Esc back",
      "dialog.controls.archive": "↑/↓ or j/k browse · read-only archive · Esc back",
      "status.active": "{count} worker(s) active",
      "state.queued": "queued",
      "state.running": "running",
      "state.waiting": "waiting",
      "state.completed": "completed",
      "state.failed": "failed",
      "state.timed_out": "timed out",
      "state.cancelled": "cancelled",
      "state.shutdown": "shutdown",
      "steering.title": "Steer worker",
      "steering.placeholder": "Instruction for the worker",
      "cancel.title": "Cancel worker",
      "cancel.message": "Cancel worker “{title}”?",
    },
  },
];

let i18nApi: I18nApiLike | undefined;

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? `{${name}}` : String(value);
  });
}

function localMessage(key: string): string {
  return I18N_BUNDLES[0]!.messages[key] ?? `${I18N_NAMESPACE}.${key}`;
}

export const t: Translate = (key, params) => {
  const fullKey = `${I18N_NAMESPACE}.${key}`;
  try {
    const translated = i18nApi?.t(fullKey, params);
    if (translated && translated !== fullKey) return translated;
  } catch {
    // pi-di18n is optional; keep the local Chinese fallback.
  }
  return interpolate(localMessage(key), params);
};

export function setupI18n(pi: ExtensionAPI, onChange?: () => void): void {
  const register = (api?: I18nApiLike) => {
    if (!api?.registerBundle) return;
    for (const bundle of I18N_BUNDLES) {
      try { api.registerBundle(bundle); } catch { /* optional integration */ }
    }
  };
  const request = (eventName: string) => {
    try {
      pi.events?.emit?.(eventName, {
        reply: (api: I18nApiLike) => {
          if (i18nApi || typeof api?.t !== "function") return;
          i18nApi = api;
          register(api);
          onChange?.();
        },
      } satisfies I18nRequestPayload);
    } catch {
      // pi-di18n is optional.
    }
  };
  const publish = (eventName: string) => {
    for (const bundle of I18N_BUNDLES) {
      try { pi.events?.emit?.(eventName, bundle); } catch { /* optional integration */ }
    }
  };
  request("pi-core/i18n/requestApi");
  request("pi-i18n/requestApi");
  publish("pi-core/i18n/registerBundle");
  publish("pi-i18n/registerBundle");
}
