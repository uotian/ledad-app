'use client';
import { useState } from 'react';
import { useI18n } from './LanguageProvider';
import {
  analyzeIntervals,
  saveAnalyzeInterval,
  useAnalyzeInterval,
  type AnalyzeInterval,
} from './analyze-interval';
import ErrorBanner from '@/components/ui/ErrorBanner';

export default function AnalyzeIntervalSettings() {
  const { t } = useI18n();
  const interval = useAnalyzeInterval();
  const [error, setError] = useState('');
  return (
    <section>
      <label className="field">
        {t('会話分析後の待機時間')}
        <select
          value={interval}
          onChange={(event) => {
            try {
              saveAnalyzeInterval(Number(event.target.value) as AnalyzeInterval);
              setError('');
            } catch {
              setError(t('会話分析後の待機時間を保存できませんでした。'));
            }
          }}
        >
          {analyzeIntervals.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds === 0
                ? t('すぐに送信')
                : seconds < 60
                  ? `${seconds}${t('秒')}`
                  : `${seconds / 60}${t('分')}`}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        {t('最初はすぐに送信し、分析完了後に設定した時間だけ待ちます。')}
      </p>
      <ErrorBanner message={error} />
    </section>
  );
}
