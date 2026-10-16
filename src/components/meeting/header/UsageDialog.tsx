import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileJson2, X } from 'lucide-react';
import { useI18n } from '@/components/settings/LanguageProvider';
import { pollUsage } from '@/lib/usage/poll';
import { desktopInvoke, isDesktop } from '@/lib/desktop';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
import { compareUsageOperations } from '@/lib/usage/operations';
import ErrorBanner from '@/components/ui/ErrorBanner';
import Button from '@/components/ui/Button';
import styles from './usage.module.css';
import UsageDetailDialog from './UsageDetailDialog';

type UsageRecord = {
  id: string;
  provider: 'openai' | 'gemini';
  operation: string;
  operationLabel: string;
  model: string;
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  audioInputSeconds: number | null;
  errorCode: string | null;
  unused: boolean;
  yen: number | null;
  errorDetails?: { reason: string | null; messageSummary: string[] };
};

export default function UsageDialog({
  sessionId,
  onClose,
  onError,
}: {
  sessionId: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const dismiss = useDialogDismiss();
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const [provider, setProvider] = useState<UsageRecord['provider']>('openai');
  const [operation, setOperation] = useState('');
  const [selected, setSelected] = useState<UsageRecord | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('.icon-button')?.focus();
  }, []);
  useEffect(
    () =>
      pollUsage<UsageRecord[]>(
        `/api/sessions/${sessionId}/usage`,
        (result) => {
          setRecords(result);
          setNow(Date.now());
          setError('');
        },
        () => setError('API履歴を取得できませんでした。'),
      ),
    [sessionId],
  );
  const statuses = {
    running: t('処理中'),
    completed: t('成功'),
    failed: t('失敗'),
    cancelled: t('取消'),
  };
  const filtered = records?.filter((record) => record.provider === provider);
  const operations = Array.from(
    new Map(filtered?.map((record) => [record.operation, record.operationLabel])),
  ).sort(([a], [b]) => compareUsageOperations(a, b));
  const visible = filtered?.filter((record) => !operation || record.operation === operation);
  const number = (value: number | null) =>
    value == null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const summary = (id: string, source = filtered) => {
    const items = source?.filter((record) => !id || record.operation === id) ?? [];
    const known = items.filter((record) => record.yen != null);
    const yen = known.reduce((total, record) => total + (record.yen ?? 0), 0);
    const amount =
      items.length && !known.length
        ? '—'
        : t('{amount}円', {
            amount:
              yen > 0 && yen < 0.1
                ? '<0.1'
                : yen.toLocaleString(locale, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
          });
    return `${t('{count}件', { count: items.length })}/${amount}`;
  };
  return (
    <>
      <dialog
        {...dismiss}
        ref={dialog}
        className={`settings-dialog ${styles.dialog}`}
        aria-labelledby="usage-title"
        onCancel={onClose}
        onClose={onClose}
      >
        <div className={`section-heading ${styles.heading}`}>
          <h2 id="usage-title">{t('API履歴')}</h2>
          <div className={styles.providers} role="group" aria-label={t('API提供元')}>
            {(['openai', 'gemini'] as const).map((id) => (
              <Button
                key={id}
                small
                variant={provider === id ? 'primary' : 'secondary'}
                aria-pressed={provider === id}
                onClick={() => {
                  setProvider(id);
                  setOperation('');
                }}
              >
                {id === 'openai' ? 'OpenAI' : 'Gemini'} (
                {summary(
                  '',
                  records?.filter((record) => record.provider === id),
                )}
                )
              </Button>
            ))}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('閉じる')}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.filter} role="group" aria-label={t('処理')}>
          {[['', t('全て')], ...operations].map(([id, label]) => (
            <Button
              key={id}
              small
              variant={operation === id ? 'primary' : 'secondary'}
              aria-pressed={operation === id}
              onClick={() => setOperation(id)}
            >
              {t(label)} ({summary(id)})
            </Button>
          ))}
        </div>
        <ErrorBanner message={error} />
        {records === null ? (
          !error && <p role="status">{t('読み込み中…')}</p>
        ) : !filtered?.length ? (
          <p>{t('APIの利用記録はありません。')}</p>
        ) : (
          <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('API履歴の表')}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('日時')}</th>
                  <th scope="col">{t('所要時間')}</th>
                  <th scope="col">{t('処理・モデル')}</th>
                  <th scope="col">{t('状態')}</th>
                  <th scope="col">{t('トークン')}</th>
                  <th scope="col">{t('キャッシュ')}</th>
                  <th scope="col">{t('備考')}</th>
                  <th scope="col">{t('詳細')}</th>
                </tr>
              </thead>
              <tbody>
                {visible?.map((record) => {
                  const [date, start] = formatTranscriptTime(record.startedAt).split(' ');
                  return (
                    <tr key={record.id}>
                      <td>
                        <div className={styles.dateTime}>
                          {date}
                          <time dateTime={record.startedAt}>{start}</time>
                        </div>
                      </td>
                      <td>
                        {record.endedAt || record.status === 'running'
                          ? t('{seconds}秒', {
                              seconds: number(
                                Math.max(
                                  0,
                                  ((record.endedAt ? Date.parse(record.endedAt) : now) -
                                    Date.parse(record.startedAt)) /
                                    1000,
                                ),
                              ),
                            })
                          : '—'}
                      </td>
                      <td>
                        {t(record.operationLabel)}
                        <small>{record.model}</small>
                      </td>
                      <td data-status={record.status}>{statuses[record.status]}</td>
                      <td>
                        <dl className={styles.metrics}>
                          <dt title={t('入力トークン')}>IN</dt>
                          <dd>{number(record.inputTokens)}</dd>
                          <dt title={t('出力トークン')}>OUT</dt>
                          <dd>{number(record.outputTokens)}</dd>
                        </dl>
                      </td>
                      <td>
                        <dl className={styles.metrics}>
                          <dt title={t('キャッシュ読込')}>READ</dt>
                          <dd>{number(record.cachedTokens)}</dd>
                          <dt title={t('キャッシュ書込')}>WRITE</dt>
                          <dd>{number(record.cacheWriteTokens)}</dd>
                        </dl>
                      </td>
                      <td className={styles.details}>
                        {record.unused && <div>{t('不利用')}</div>}
                        {record.errorCode && (
                          <div>
                            {record.errorDetails?.reason === 'timeout'
                              ? t('タイムアウト')
                              : [record.errorCode, record.errorDetails?.reason]
                                  .filter(Boolean)
                                  .join(' / ')}
                          </div>
                        )}
                        {record.errorDetails?.messageSummary.map((message, i) => (
                          <div key={i}>{t(message)}</div>
                        ))}
                        {record.audioInputSeconds !== null && (
                          <div>
                            {t('入力音声：{seconds}秒', {
                              seconds: number(record.audioInputSeconds),
                            })}
                          </div>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={t('APIの詳細を開く')}
                          title={t('APIの詳細を開く')}
                          aria-haspopup="dialog"
                          onClick={() => setSelected(record)}
                        >
                          <FileJson2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className={styles.footer}>
          <a
            className={styles.billing}
            href={
              provider === 'openai'
                ? 'https://platform.openai.com/settings/organization/billing/overview'
                : 'https://aistudio.google.com/billing'
            }
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (isDesktop()) {
                event.preventDefault();
                void desktopInvoke('open_billing', { provider }).catch(() =>
                  onError(t('課金画面を開けませんでした。')),
                );
              }
            }}
          >
            {t('{provider}のAPI課金画面を開く', {
              provider: provider === 'openai' ? 'OpenAI' : 'Gemini',
            })}
            <ExternalLink size={14} />
          </a>
        </footer>
      </dialog>
      {selected && (
        <UsageDetailDialog
          key={selected.id}
          sessionId={sessionId}
          recordId={selected.id}
          operation={selected.operationLabel}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
