import { useI18n } from '@/components/settings/LanguageProvider';
import type { ReviewProgress } from '@/lib/audio/review-buffer';
import styles from './fix-progress.module.css';

export default function FixProgress({ progress }: { progress: ReviewProgress }) {
  const { t } = useI18n();
  if (progress.state === 'idle') return null;
  const text =
    progress.state === 'processing'
      ? t('Fix処理中')
      : progress.state === 'boundary'
        ? t('Fix区切り待ち')
        : progress.state === 'context'
          ? t('Fix聞き取り中（−{seconds}秒）', { seconds: progress.elapsedSeconds })
          : t('Fix聞き取り中（あと約{seconds}秒）', {
              seconds: progress.remainingSeconds,
            });
  return (
    <span className={styles.progress} data-fix-state={progress.state} aria-live="off">
      {text}
    </span>
  );
}
