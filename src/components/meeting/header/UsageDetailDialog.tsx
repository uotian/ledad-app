import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { pollUsage } from '@/lib/usage/poll';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
import { useI18n } from '@/components/settings/LanguageProvider';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { usageTextBlocks } from './usage-text';
import styles from './usage.module.css';

type Detail = {
  record: { model: string; startedAt: string; status: string };
  request: unknown;
  response: unknown;
  error: unknown;
};
const tabs = ['リクエスト', 'レスポンス'] as const;

export default function UsageDetailDialog({
  sessionId,
  recordId,
  operation,
  onClose,
}: {
  sessionId: string;
  recordId: string;
  operation: string;
  onClose: () => void;
}) {
  const dismiss = useDialogDismiss();
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(
    () =>
      pollUsage<Detail>(
        `/api/sessions/${sessionId}/usage/${recordId}`,
        (next) => {
          setDetail(next);
          setError('');
          return next.record.status === 'running';
        },
        () => setError('APIの詳細を取得できませんでした。'),
      ),
    [sessionId, recordId],
  );
  const value = tab === 0 ? detail?.request : detail?.response;
  const textBlocks = usageTextBlocks(value);
  return (
    <dialog
      {...dismiss}
      ref={dialog}
      className={`settings-dialog ${styles.detailDialog}`}
      aria-labelledby="usage-detail-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="section-heading">
        <h2 id="usage-detail-title">
          {t('APIの詳細')} · {t(operation)}
        </h2>
        <button className="icon-button" onClick={onClose} aria-label={t('閉じる')}>
          <X size={18} />
        </button>
      </div>
      {detail && (
        <p className={styles.description}>
          {detail.record.model} · {formatTranscriptTime(detail.record.startedAt)}
        </p>
      )}
      <div className={styles.detailTabs} role="tablist" aria-label={t('APIの内容')}>
        {tabs.map((label, index) => (
          <button
            key={label}
            id={`usage-detail-tab-${index}`}
            role="tab"
            aria-selected={tab === index}
            aria-controls="usage-detail-panel"
            tabIndex={tab === index ? 0 : -1}
            onClick={() => setTab(index)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
              setTab(next);
              document.getElementById(`usage-detail-tab-${next}`)?.focus();
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <ErrorBanner message={error} />
      <div
        id="usage-detail-panel"
        role="tabpanel"
        aria-labelledby={`usage-detail-tab-${tab}`}
        tabIndex={0}
        className={styles.jsonPanel}
      >
        {!detail ? (
          !error && <p role="status">{t('読み込み中…')}</p>
        ) : (
          <>
            {value != null ? (
              textBlocks.length ? (
                <>
                  {textBlocks.map(({ path, text }) => (
                    <section className={styles.textBlock} key={path}>
                      <h3>{path}</h3>
                      <pre>{text}</pre>
                    </section>
                  ))}
                  <details className={styles.rawJson}>
                    <summary>{t('JSONを表示')}</summary>
                    <pre>{JSON.stringify(value, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <pre>{JSON.stringify(value, null, 2)}</pre>
              )
            ) : (
              <p>
                {t(
                  tab === 1 && detail.record.status === 'running'
                    ? '応答を待っています。'
                    : '本文の記録はありません。',
                )}
              </p>
            )}
            {tab === 1 && detail.error != null && (
              <>
                <h3>{t('エラー')}</h3>
                <pre>{JSON.stringify(detail.error, null, 2)}</pre>
              </>
            )}
          </>
        )}
      </div>
      <p className={styles.description}>
        {t('認証情報は伏せ、音声・画像の本体は省略しています。')}
      </p>
    </dialog>
  );
}
