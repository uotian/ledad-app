import { useI18n } from '@/components/settings/LanguageProvider';
import type { Language, Transcript } from '@/lib/session/schema';
import { formatTranscript, formatTranscriptTime } from '@/lib/session/transcript-display';
export default function TranscriptItem({
  item,
  language,
  active,
  pendingTranslation,
}: {
  item: Transcript;
  language: Language;
  active: boolean;
  pendingTranslation?: { text: string; language: Language };
}) {
  const { t } = useI18n();
  const translation =
    !item.analyzed && pendingTranslation?.language === language
      ? pendingTranslation.text
      : (item.translationLanguage ?? 'ja') === language
        ? item.translation
        : '';
  const hasTranslation = !!translation;
  return (
    <article
      data-transcript-id={item.id}
      data-recognition={item.correctedAt ? 'fixed' : 'live'}
      className={`transcript-item ${active ? 'transcript-active' : ''} ${hasTranslation ? 'has-translation' : ''}`}
    >
      <div className="transcript-meta">
        <time dateTime={item.timestamp}>{formatTranscriptTime(item.timestamp)}</time>
        {item.source === 'manual' ? (
          <span>{t('手入力の記録')}</span>
        ) : (
          <strong>{item.correctedAt ? 'Fixed' : 'Live'}</strong>
        )}
        {item.disposition !== 'open' && (
          <span>
            {
              { deferred: t('保留中'), skipped: t('見送り'), answered: t('回答済み') }[
                item.disposition
              ]
            }
          </span>
        )}
      </div>
      <p>{formatTranscript(item.text)}</p>
      {hasTranslation && (
        <p className="transcript-translation" lang={language}>
          {formatTranscript(translation)}
        </p>
      )}
    </article>
  );
}
