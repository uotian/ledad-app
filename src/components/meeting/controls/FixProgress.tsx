import { useI18n } from '@/components/settings/LanguageProvider';
import type { ReviewProgress } from '@/lib/audio/review-buffer';
import styles from './fix-progress.module.css';

export default function FixProgress({ progress }: { progress: ReviewProgress }) {
  const { t } = useI18n();
  if (progress.state === 'idle') return null;
  const text =
    progress.state === 'processing'
      ? t('Fix聞き取りの処理中')
      : progress.state === 'boundary'
        ? t('Fix聞き取りの区切り待ち')
        : t(
            progress.state === 'context'
              ? 'Fix追加音声取得中（あと約{seconds}秒）'
              : 'Fix聞き取り中（あと約{seconds}秒）',
            {
              seconds: progress.remainingSeconds,
            },
          );
  return (
    <span className={styles.progress} data-fix-state={progress.state} aria-live="off">
      {text}
    </span>
  );
}
