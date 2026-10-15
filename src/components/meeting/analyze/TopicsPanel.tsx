import { useI18n } from '@/components/settings/LanguageProvider';
import type { AnalyzeRuntime } from './useAnalyze';
import { mentionTimestamp } from '@/lib/session/analyze';
import type { Session } from '@/lib/session/schema';
import Topics from './Topics';
import styles from './analyze.module.css';

export default function TopicsPanel({
  active,
  session,
  runtime,
}: {
  active: boolean;
  session: Session;
  runtime: AnalyzeRuntime;
}) {
  const analyze = session.analyze;
  const timestamps = Object.fromEntries(
    (analyze?.topics ?? []).map((topic) => [
      topic.id,
      mentionTimestamp(session, analyze?.topicEvidence?.[topic.id] ?? ''),
    ]),
  );
  const { t } = useI18n();
  return (
    <section className={styles.panel} aria-label="Topics" aria-busy={runtime.pending}>
      {runtime.error && (
        <p className={styles.error} role="status">
          {t(runtime.error)}
        </p>
      )}
      <Topics
        topics={analyze?.topics ?? []}
        timestamps={timestamps}
        active={active}
        updatedAt={analyze?.updatedAt}
      />
    </section>
  );
}
