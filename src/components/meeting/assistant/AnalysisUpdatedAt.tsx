import { useEffect, useState } from 'react';
import { useI18n } from '@/components/settings/LanguageProvider';
import { formatTimeAgo } from '../for-you/relative-time';

export default function AnalysisUpdatedAt({ timestamp }: { timestamp: string }) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const date = new Date(timestamp);
  return (
    <footer className="assistant-updated-at">
      {t('最終更新')}{' '}
      <time dateTime={timestamp} title={date.toLocaleString(locale)}>
        {formatTimeAgo(date.getTime(), now, locale)}
      </time>
    </footer>
  );
}
