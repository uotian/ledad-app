'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { Languages, MessageCircle, Mic, Timer } from 'lucide-react';
import type { Settings } from '@/lib/session/schema';
export default function AudioSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="audio-settings">
      <div className="form-grid audio-settings-grid">
        <label className="field">
          <span>
            <MessageCircle size={14} aria-hidden="true" />
            {t('会議の言語')}
          </span>
          <select
            value={settings.language}
            onChange={(e) =>
              onChange({ ...settings, language: e.target.value as Settings['language'] })
            }
          >
            <option value="ja">{t('日本語')}</option>
            <option value="en">{t('英語 / English')}</option>
            <option value="zh">{t('中国語 / 中文（简体）')}</option>
            <option value="fr">{t('フランス語 / Français')}</option>
          </select>
        </label>
        <label className="field">
          <span>
            <Languages size={14} aria-hidden="true" />
            {t('翻訳先の言語')}
          </span>
          <select
            value={settings.translationLanguage ?? 'ja'}
            onChange={(e) =>
              onChange({
                ...settings,
                translationLanguage: e.target.value as Settings['translationLanguage'],
              })
            }
          >
            <option value="ja">{t('日本語')}</option>
            <option value="en">{t('英語 / English')}</option>
            <option value="zh">{t('中国語 / 中文（简体）')}</option>
            <option value="fr">{t('フランス語 / Français')}</option>
          </select>
        </label>
        <div className="field audio-input-field">
          <label htmlFor="audio-input">
            <Mic size={14} />
            {t('聞き取り音声の入力元')}
          </label>
          <select
            id="audio-input"
            value={settings.input}
            onChange={(e) => onChange({ ...settings, input: e.target.value as Settings['input'] })}
          >
            <option value="mixed">{t('PCの音声＋マイク(Zoom)')}</option>
            <option value="display">{t('PCの音声(YouTube)')}</option>
            <option value="microphone">{t('マイクの音声(対面会議)')}</option>
          </select>
        </div>
        <label className="field" htmlFor="listening-limit">
          <span>
            <Timer size={14} aria-hidden="true" />
            {t('自動停止時間')}
          </span>
          <select
            id="listening-limit"
            value={settings.listeningLimitMinutes}
            onChange={(e) =>
              onChange({
                ...settings,
                listeningLimitMinutes: Number(e.target.value) as Settings['listeningLimitMinutes'],
              })
            }
          >
            <option value="10">10 min</option>
            <option value="30">30 min</option>
            <option value="60">60 min</option>
            <option value="90">90 min</option>
          </select>
        </label>
      </div>
    </div>
  );
}
