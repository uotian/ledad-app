import { useI18n } from '@/components/settings/LanguageProvider';
import type { Minutes } from '@/lib/session/schema';
export default function QuestionRecord({
  item,
  index,
}: {
  item: Minutes['questions'][number];
  index: number;
}) {
  const { t } = useI18n();
  return (
    <article className="question-record">
      <div>
        <span className="record-number">{String(index + 1).padStart(2, '0')}</span>
        <h3>{item.question}</h3>
        <span className={`pill ${item.status === 'answered' ? 'pill-green' : 'pill-amber'}`}>
          {item.status === 'answered'
            ? t('回答あり')
            : item.status === 'unanswered'
              ? t('未回答')
              : t('要確認')}
        </span>
      </div>
      <p>{item.answer}</p>
      {item.evidenceIds.length > 0 && (
        <small>{t('原記録 {count} 件に基づく', { count: item.evidenceIds.length })}</small>
      )}
    </article>
  );
}
