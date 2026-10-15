import { messages } from './messages';
export type AppLanguage = 'ja' | 'en' | 'zh' | 'fr';
export const languageStorageKey = 'ledad.language';
export const languageChanged = 'ledad-language-changed';
export const locales = { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN', fr: 'fr-FR' } as const;
export function parseLanguage(value: unknown): AppLanguage {
  return value === 'en' || value === 'zh' || value === 'fr' ? value : 'ja';
}
export function translate(
  language: AppLanguage,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const aiError = /^(OpenAI|Gemini) \/ ([^：]+)：(.+)$/s.exec(key);
  if (aiError)
    return `${aiError[1]} / ${translate(language, aiError[2])}${language === 'fr' ? ' : ' : language === 'en' ? ': ' : '：'}${translate(language, aiError[3], values)}`;
  const text = language === 'ja' ? key : (messages[key]?.[language] ?? key);
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
