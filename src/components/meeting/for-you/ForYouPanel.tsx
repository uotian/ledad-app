import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/settings/LanguageProvider';
import { mentionId } from '@/lib/session/analyze';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
import type { useMentions } from '../analyze/useMentions';
import { formatTimeAgo } from './relative-time';
import styles from './for-you.module.css';

export default function ForYouPanel({
  active,
  updatedAt,
  mentions,
  configured,
  pending,
  error,
}: {
  active: boolean;
  updatedAt?: string;
  mentions: ReturnType<typeof useMentions>['mentions'];
  configured: boolean;
  pending: boolean;
  error: string;
}) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (active && list) list.scrollTop = list.scrollHeight;
  }, [active, updatedAt]);
  const labels = { mention: t('言及'), question: t('質問'), request: t('依頼') };
  return (
    <section className={styles.panel} aria-label="You" aria-busy={pending}>
      {error && (
        <p className={styles.error} role="status">
          {t(error)}
        </p>
      )}
      <h2>
        {t('登録されたあなたの名前への言及')}
        <span className={styles.count}>{mentions.length}</span>
      </h2>
      <div
        ref={listRef}
        className={styles.mentionList}
        tabIndex={0}
        role="region"
        aria-label={t('言及の一覧')}
      >
        {!configured ? (
          <p className={styles.empty}>
            {t('設定で「あなたの名前・呼ばれ方」を登録すると、言及を見つけます。')}
          </p>
        ) : !mentions.length ? (
          <p className={styles.empty}>{t('言及はありません。')}</p>
        ) : null}
        {mentions.map((mention, index) => {
          const id = `${mentionId(mention)}:${index}`;
          const date = mention.timestamp ? new Date(mention.timestamp) : null;
          const hasTime = date !== null && !Number.isNaN(date.getTime());
          return (
            <article key={id} className={styles.mention}>
              <div className={styles.mentionHeading}>
                <strong data-kind={mention.kind}>{labels[mention.kind]}</strong>
                {hasTime ? (
                  <time
                    dateTime={mention.timestamp!}
                    title={`${t('発言の開始時刻')}：${date.toLocaleString(locale)}`}
                  >
                    {formatTranscriptTime(mention.timestamp!)} (
                    {formatTimeAgo(date.getTime(), now, locale)})
                  </time>
                ) : (
                  <span className={styles.unknownTime}>{t('時刻不明')}</span>
                )}
              </div>
              <p>{mention.summary}</p>
              <blockquote>{mention.quote}</blockquote>
            </article>
          );
        })}
      </div>
    </section>
  );
}
