import { useI18n } from '@/components/settings/LanguageProvider';
import { AlertCircle, X } from 'lucide-react';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
export default function ErrorBanner({
  message,
  occurredAt,
  onDismiss,
}: {
  message: string;
  occurredAt?: string;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div role="alert" className="error-banner">
      <AlertCircle size={18} />
      <span>
        {occurredAt && (
          <>
            <time dateTime={occurredAt}>{formatTranscriptTime(occurredAt)}</time>
            {'　'}
          </>
        )}
        {t(message)}
      </span>
      {onDismiss && (
        <button aria-label={t('エラーを閉じる')} onClick={onDismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
