import { useI18n } from '@/components/settings/LanguageProvider';
import HomeLink from '@/components/shell/HomeLink';
import {
  ArrowLeft,
  Download,
  FileCheck2,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  ClipboardList,
  LoaderCircle,
} from 'lucide-react';
import type { Session } from '@/lib/session/schema';
import type { Meeting } from '@/hooks/useMeeting';
import { downloadMarkdown } from '@/lib/session/markdown';
import Button from '@/components/ui/Button';
import RecordSection from './RecordSection';
import QuestionRecord from './QuestionRecord';
export default function RecordsScreen({
  session,
  meeting,
  onHome,
  onBack,
}: {
  session: Session;
  meeting: Meeting;
  onHome: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useI18n();
  const minutes = session.minutes;
  const spoken = session.utterances.filter((u) => u.status === 'completed').length;
  return (
    <>
      <div className="page-header">
        <div>
          <HomeLink className="back-link" onHome={onHome}>
            <ArrowLeft size={14} />
            {t('ホーム')}
          </HomeLink>
          <h1>{t('会議の記録')}</h1>
          <p>{session.title}</p>
        </div>
        <Button
          onClick={() =>
            downloadMarkdown(session).catch(() =>
              meeting.setError(t('記録を保存できませんでした。保存先を確認してください。')),
            )
          }
        >
          <Download size={16} />
          {t('Markdownで保存')}
        </Button>
      </div>
      <Button small onClick={onBack} disabled={meeting.summarizing}>
        <ArrowLeft size={14} /> {t('「{title}」に戻る', { title: session.title })}
      </Button>
      <div className="record-hero">
        <div>
          <span className="record-check">
            <FileCheck2 size={26} />
          </span>
          <h2>{t('おつかれさまでした。')}</h2>
          <p>{t('交わした言葉を、次の一歩につなげましょう。')}</p>
        </div>
        <div className="record-stats">
          <span>
            <strong>{session.transcripts.length}</strong>
            {t('記録した発言')}
          </span>
          <span>
            <strong>{spoken}</strong>
            {t('完了した発話')}
          </span>
          <span>
            <strong>
              {minutes?.questions.filter((q) => q.status !== 'answered').length ?? '—'}
            </strong>
            {t('未回答・要確認')}
          </span>
        </div>
      </div>
      {meeting.summarizing ? (
        <div className="card summary-loading" role="status">
          <LoaderCircle className="spin" size={24} />
          <span className="thinking-label">{t('会話から記録をまとめています…')}</span>
        </div>
      ) : !minutes ? (
        <div className="card summary-loading">
          <p>{t('原記録は保存されています。要約を作成できます。')}</p>
          <Button variant="primary" onClick={meeting.createMinutes}>
            <Sparkles size={16} />
            {t('記録を作成する')}
          </Button>
        </div>
      ) : (
        <>
          <div className="record-grid">
            <RecordSection
              title={t('会議の要点')}
              icon={<ClipboardList size={19} />}
              items={minutes.summary}
              empty={t('要点としてまとめられる発言はありませんでした。')}
            />
            <div className="record-grid-side">
              <RecordSection
                title={t('決定事項')}
                icon={<FileCheck2 size={19} />}
                items={minutes.decisions}
                empty={t('明示的な決定は確認されていません。')}
              />
              <RecordSection
                title={t('次のアクション')}
                icon={<ListChecks size={19} />}
                items={minutes.actions}
                empty={t('確定した対応事項はありません。')}
              />
            </div>
          </div>
          <section className="card record-questions">
            <div className="section-heading">
              <h2>
                <MessageCircleQuestion size={19} />
                {t('質問と回答')}
              </h2>
              <span>{t('{count}件', { count: minutes.questions.length })}</span>
            </div>
            {minutes.questions.length ? (
              minutes.questions.map((q, i) => <QuestionRecord key={i} item={q} index={i} />)
            ) : (
              <p className="muted">{t('質問と回答は記録されていません。')}</p>
            )}
          </section>
          {minutes.caveats.length > 0 && (
            <div className="record-caveats">
              <strong>{t('記録について')}</strong>
              <ul>
                {minutes.caveats.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <details className="card raw-record">
        <summary>{t('原記録を確認する · 聞き取りと実際の発話')}</summary>
        <div>
          {session.transcripts.map((transcript) => (
            <article key={transcript.id}>
              <small>
                {new Date(transcript.timestamp).toLocaleTimeString(locale)} ·{' '}
                {transcript.source === 'manual' ? t('手入力') : t('聞き取り')} · {transcript.id}
              </small>
              <p>{transcript.text}</p>
            </article>
          ))}
          {session.utterances.map((u) => (
            <article key={u.id}>
              <small>
                {t('AIの発話 ·')}
                {u.status === 'completed' ? t('完了') : t('中断・失敗')} · {u.id}
              </small>
              <p>{u.completedText || t('再生完了を確認した区間はありません。')}</p>
              {u.status !== 'completed' && (
                <p className="field-help">
                  {t(
                    '最後の区間が途中まで再生された可能性があります。全文を話した扱いにはしていません。',
                  )}
                </p>
              )}
            </article>
          ))}
        </div>
      </details>
      <p className="privacy-footnote">
        {t(
          '会議・資料・記録はこのMacのアプリ専用フォルダに保存しています。ホームから削除できます。AI利用記録には本文を含めず、会議の削除後も残します。',
        )}
      </p>
    </>
  );
}
