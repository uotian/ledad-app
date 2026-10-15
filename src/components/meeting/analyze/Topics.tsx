import { useEffect, useRef, useState } from 'react';
import { formatTimeAgo } from '../for-you/relative-time';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/components/settings/LanguageProvider';
import type { Analyze } from '@/lib/session/analyze';
import styles from './analyze.module.css';

export default function Topics({
  topics,
  active = true,
  updatedAt,
  timestamps = {},
}: {
  topics: Analyze['topics'];
  active?: boolean;
  updatedAt?: string;
  timestamps?: Record<string, string | null>;
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
  return (
    <div ref={listRef} className={styles.topics} tabIndex={0} role="region" aria-label={'Topics'}>
      {!topics.length && (
        <p className={styles.empty}>{t('会話が進むと、トピックをここに整理します。')}</p>
      )}
      {topics.map((topic, index) => (
        <article className={styles.topic} key={`${topic.id}:${index}`}>
          <h3>
            <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
            <span>{topic.title}</span>
            {timestamps[topic.id] && (
              <time
                className={styles.time}
                dateTime={timestamps[topic.id]!}
                title={new Date(timestamps[topic.id]!).toLocaleString(locale)}
              >
                {formatTimeAgo(new Date(timestamps[topic.id]!).getTime(), now, locale)}
              </time>
            )}
          </h3>
          <div className={styles.summary}>
            <Markdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              allowedElements={[
                'p',
                'br',
                'strong',
                'em',
                'ul',
                'ol',
                'li',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'table',
                'thead',
                'tbody',
                'tr',
                'th',
                'td',
                'code',
              ]}
              unwrapDisallowed
              components={{
                h1: ({ children }) => <h4>{children}</h4>,
                h2: ({ children }) => <h4>{children}</h4>,
                h3: ({ children }) => <h4>{children}</h4>,
              }}
            >
              {topic.summary}
            </Markdown>
          </div>
        </article>
      ))}
    </div>
  );
}
