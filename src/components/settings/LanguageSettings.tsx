'use client';
import { parseLanguage } from '@/lib/i18n';
import { useI18n } from './LanguageProvider';
export default function LanguageSettings() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="field">
      {t('アプリの言語')}
      <select value={language} onChange={(event) => setLanguage(parseLanguage(event.target.value))}>
        <option value="ja">日本語</option>
        <option value="en">English</option>
        <option value="zh">中文（简体）</option>
        <option value="fr">Français</option>
      </select>
    </label>
  );
}
