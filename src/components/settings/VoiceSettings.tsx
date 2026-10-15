'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Settings } from '@/lib/session/schema';
import { useI18n } from './LanguageProvider';
import { readVoice, saveVoice } from './voice';
import ErrorBanner from '@/components/ui/ErrorBanner';

export default function VoiceSettings() {
  const { t } = useI18n();
  const [voice, setVoice] = useState<Settings['voice'] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // 未設定なら、これまで選んでいた会議の声を初期値として表示します。
        const value = readVoice() ?? (await api<Settings>('/api/meeting-settings')).voice;
        if (active) setVoice(value);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  function change(value: Settings['voice']) {
    try {
      saveVoice(value);
      setVoice(value);
      setError('');
    } catch {
      setError(t('声の設定を保存できませんでした。'));
    }
  }
  return (
    <section>
      <label className="field">
        {t('声の種類')}
        <select
          value={voice ?? 'Kore'}
          disabled={!voice}
          aria-describedby="voice-help"
          onChange={(e) => change(e.target.value as Settings['voice'])}
        >
          <option value="Kore">{t('Kore · 落ち着いた声')}</option>
          <option value="Aoede">{t('Aoede · 柔らかな声')}</option>
          <option value="Puck">{t('Puck · 明るい声')}</option>
          <option value="Charon">{t('Charon · 明瞭な声')}</option>
        </select>
      </label>
      <p id="voice-help" className="field-help">
        {t('次の読み上げから反映します。')}
      </p>
      <ErrorBanner message={error} />
    </section>
  );
}
