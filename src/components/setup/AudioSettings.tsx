'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { Languages, MessageCircle, Mic } from 'lucide-react';
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
            <option value="mixed">{t('PCの音声＋マイク(ZoomなどのWeb会議)')}</option>
            <option value="display">{t('PCの音声(YouTubeなど)')}</option>
            <option value="microphone">{t('マイクの音声(対面会議など)')}</option>
          </select>
        </div>
      </div>
      <details className="audio-details">
        <summary>{t('詳細設定')}</summary>
        <div className="form-grid audio-settings-grid">
          <label className="field" htmlFor="listening-limit">
            <span>{t('聞き取りの自動停止時間')}</span>
            <select
              id="listening-limit"
              value={settings.listeningLimitMinutes}
              onChange={(e) =>
                onChange({
                  ...settings,
                  listeningLimitMinutes: Number(
                    e.target.value,
                  ) as Settings['listeningLimitMinutes'],
                })
              }
            >
              <option value="10">10 min</option>
              <option value="30">30 min</option>
              <option value="60">60 min</option>
              <option value="90">90 min</option>
            </select>
          </label>
          <label className="field" htmlFor="fix-interval">
            <span>{t('Fixed文字起こしの間隔')}</span>
            <select
              id="fix-interval"
              value={settings.fixIntervalSeconds}
              onChange={(e) =>
                onChange({
                  ...settings,
                  fixIntervalSeconds: Number(e.target.value) as Settings['fixIntervalSeconds'],
                })
              }
            >
              <option value="15">15 s</option>
              <option value="30">30 s</option>
              <option value="60">60 s</option>
              <option value="120">120 s</option>
            </select>
          </label>
          <label className="field" htmlFor="vad-silence">
            <span>{t('発話区切りの無音時間')}</span>
            <select
              id="vad-silence"
              value={settings.vadSilenceMs}
              onChange={(e) =>
                onChange({
                  ...settings,
                  vadSilenceMs: Number(e.target.value) as Settings['vadSilenceMs'],
                })
              }
            >
              <option value="50">50 ms</option>
              <option value="100">100 ms</option>
              <option value="200">200 ms</option>
              <option value="300">300 ms</option>
              <option value="500">500 ms</option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}
