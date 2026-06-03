/**
 * P0-原子层：i18n 定义
 *
 * locale 检测 + 翻译 + 语言指令
 */

// ── 类型定义 ──────────────────────────────────────────────

export type SupportedLanguage =
  | "zh-Hans"
  | "zh-Hant"
  | "ja"
  | "ko"
  | "de"
  | "fr"
  | "es"
  | "pt"
  | "ru"
  | "ar"
  | "en";

// ── Locale 检测 ──────────────────────────────────────────

/**
 * 从环境变量检测 locale
 * 优先级：PI_LOCALE > LC_ALL > LANG
 */
export function detectLocale(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env.PI_LOCALE, env.LC_ALL, env.LANG].filter(Boolean) as string[];

  for (const raw of candidates) {
    const s = raw.trim();
    if (!s) continue;
    const base = s.split(".")[0]!.replace(/_/g, "-");
    if (base) return base;
  }

  return undefined;
}

/**
 * 将 locale 映射到支持的语言
 */
export function languageForLocale(locale?: string): SupportedLanguage {
  if (!locale) return "zh-Hans"; // 中文优先

  const [rawLang, rawRegion] = locale.split("-");
  const lang = rawLang?.toLowerCase() ?? "zh";
  const region = rawRegion?.toUpperCase() ?? "";

  switch (lang) {
    case "zh":
      return region === "TW" || region === "HK" || region === "MO" ? "zh-Hant" : "zh-Hans";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "de":
      return "de";
    case "fr":
      return "fr";
    case "es":
      return "es";
    case "pt":
      return "pt";
    case "ru":
      return "ru";
    case "ar":
      return "ar";
    case "en":
      return "en";
    default:
      return "zh-Hans"; // 中文优先
  }
}

// ── 语言指令 ──────────────────────────────────────────────

/**
 * 为 LLM 生成语言指令
 */
export function languageInstructionForLocale(locale?: string): string {
  switch (languageForLocale(locale)) {
    case "zh-Hans":
      return "使用简体中文输出。";
    case "zh-Hant":
      return "使用繁體中文輸出。";
    case "ja":
      return "日本語で出力してください。";
    case "ko":
      return "한국어로 출력해 주세요.";
    case "de":
      return "Geben Sie auf Deutsch aus.";
    case "fr":
      return "Veuillez sortir en français.";
    case "es":
      return "Por favor, salga en español.";
    case "pt":
      return "Por favor, saia em português.";
    case "ru":
      return "Пожалуйста, выведите на русском языке.";
    case "ar":
      return "يرجى الإخراج بالعربية.";
    case "en":
      return "Please output in English.";
    default:
      return "使用简体中文输出。";
  }
}
