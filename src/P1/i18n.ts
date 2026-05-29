/**
 * P1-分子层：i18n 翻译
 *
 * 翻译表 + 翻译函数
 */

import { SupportedLanguage, languageForLocale, detectLocale } from "../P0/i18n.js";

// ── 翻译表 ──────────────────────────────────────────────

interface TranslationTable {
  [key: string]: string;
}

const translations: Record<SupportedLanguage, TranslationTable> = {
  "zh-Hans": {
    // 通用
    "dteam.name": "dteam",
    "dteam.active": "活跃",
    "dteam.inactive": "未激活",
    
    // 状态
    "status.pending": "准备中",
    "status.running": "运行中",
    "status.done": "完成",
    "status.failed": "失败",
    
    // 任务状态
    "task.todo": "待办",
    "task.InSpec": "规格中",
    "task.InProgress": "执行中",
    "task.Done": "完成",
    "task.Cancelled": "已取消",
    
    // 角色
    "role.explore": "探索者",
    "role.design": "方案制定者",
    "role.build": "实现者",
    "role.check": "验收者",
    "role.close": "收口者",
    
    // 工具
    "tool.task.create": "创建任务",
    "tool.task.read": "读取任务",
    "tool.task.update": "更新任务",
    "tool.task.complete": "完成任务",
    "tool.task.archive": "归档任务",
    "tool.task.list": "列出任务",
    "tool.task.search": "搜索任务",
    "tool.reference.architecture": "查询架构",
    "tool.worker.create": "创建Worker",
    "tool.worker.start": "启动Worker",
    "tool.worker.sendSignal": "发送信号",
    
    // 信号
    "signal.progress": "进度",
    "signal.blocked": "阻塞",
    "signal.found": "发现",
    "signal.help": "帮助",
    
    // 策略
    "strategy.retry": "重试",
    "strategy.adjust": "调整",
    "strategy.switch": "切换",
    "strategy.replan": "重新规划",
    "strategy.learn": "学习",
    
    // 模式
    "mode.solo": "单任务",
    "mode.chain": "串行",
    "mode.team": "并行",
    
    // 命令输出
    "dstat.no_tasks": "无活跃任务",
    "dstat.task_count": "个任务",
  },
  "zh-Hant": {
    "dteam.name": "dteam",
    "dteam.active": "活躍",
    "dteam.inactive": "未啟用",
    "status.pending": "準備中",
    "status.running": "運行中",
    "status.done": "完成",
    "status.failed": "失敗",
    "task.todo": "待辦",
    "task.InSpec": "規格中",
    "task.InProgress": "執行中",
    "task.Done": "完成",
    "task.Cancelled": "已取消",
    "role.explore": "探索者",
    "role.design": "方案制定者",
    "role.build": "實現者",
    "role.check": "驗收者",
    "role.close": "收口者",
  },
  "ja": {
    "dteam.name": "dteam",
    "dteam.active": "アクティブ",
    "dteam.inactive": "非アクティブ",
    "status.pending": "準備中",
    "status.running": "実行中",
    "status.done": "完了",
    "status.failed": "失敗",
    "task.todo": "TODO",
    "task.InSpec": "仕様中",
    "task.InProgress": "実行中",
    "task.Done": "完了",
    "task.Cancelled": "キャンセル",
    "role.explore": "探索者",
    "role.design": "設計者",
    "role.build": "実装者",
    "role.check": "検証者",
    "role.close": "クローズ",
  },
  "ko": {
    "dteam.name": "dteam",
    "dteam.active": "활성",
    "dteam.inactive": "비활성",
    "status.pending": "대기 중",
    "status.running": "실행 중",
    "status.done": "완료",
    "status.failed": "실패",
  },
  "de": {
    "dteam.name": "dteam",
    "dteam.active": "Aktiv",
    "dteam.inactive": "Inaktiv",
    "status.pending": "Ausstehend",
    "status.running": "Läuft",
    "status.done": "Fertig",
    "status.failed": "Fehlgeschlagen",
  },
  "fr": {
    "dteam.name": "dteam",
    "dteam.active": "Actif",
    "dteam.inactive": "Inactif",
    "status.pending": "En attente",
    "status.running": "En cours",
    "status.done": "Terminé",
    "status.failed": "Échoué",
  },
  "es": {
    "dteam.name": "dteam",
    "dteam.active": "Activo",
    "dteam.inactive": "Inactivo",
    "status.pending": "Pendiente",
    "status.running": "En ejecución",
    "status.done": "Completado",
    "status.failed": "Fallido",
  },
  "pt": {
    "dteam.name": "dteam",
    "dteam.active": "Ativo",
    "dteam.inactive": "Inativo",
    "status.pending": "Pendente",
    "status.running": "Em execução",
    "status.done": "Concluído",
    "status.failed": "Falhou",
  },
  "ru": {
    "dteam.name": "dteam",
    "dteam.active": "Активен",
    "dteam.inactive": "Неактивен",
    "status.pending": "Ожидание",
    "status.running": "Выполняется",
    "status.done": "Завершено",
    "status.failed": "Ошибка",
  },
  "ar": {
    "dteam.name": "dteam",
    "dteam.active": "نشط",
    "dteam.inactive": "غير نشط",
    "status.pending": "قيد الانتظار",
    "status.running": "قيد التشغيل",
    "status.done": "تم",
    "status.failed": "فشل",
  },
  "en": {
    "dteam.name": "dteam",
    "dteam.active": "Active",
    "dteam.inactive": "Inactive",
    "status.pending": "Pending",
    "status.running": "Running",
    "status.done": "Done",
    "status.failed": "Failed",
    "task.todo": "Todo",
    "task.InSpec": "In Spec",
    "task.InProgress": "In Progress",
    "task.Done": "Done",
    "task.Cancelled": "Cancelled",
    "role.explore": "Explorer",
    "role.design": "Designer",
    "role.build": "Builder",
    "role.check": "Checker",
    "role.close": "Closer",
    "mode.solo": "Solo",
    "mode.chain": "Chain",
    "mode.team": "Team",
  },
};

// ── 翻译函数 ──────────────────────────────────────────────

/**
 * 翻译函数
 * 
 * @param key 翻译键
 * @param locale 目标 locale，不传则自动检测
 * @returns 翻译后的文本，fallback 到 zh-Hans，最后返回 key 本身
 */
export function t(key: string, locale?: string): string {
  const lang = languageForLocale(locale ?? detectLocale());
  const table = translations[lang];
  
  if (table && table[key]) {
    return table[key];
  }
  
  // fallback 到 zh-Hans
  if (lang !== "zh-Hans" && translations["zh-Hans"][key]) {
    return translations["zh-Hans"][key];
  }
  
  // 最后 fallback 到 key 本身
  return key;
}
