import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import { useI18n } from '@/components/settings/LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import { Clock3, Columns2, FileText, LoaderCircle, PanelLeft, PanelRight, X } from 'lucide-react';
import ErrorBanner from '@/components/ui/ErrorBanner';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Meeting } from '@/hooks/useMeeting';
import ConversationPanel from './conversation/ConversationPanel';
import AssistantPanel, { type AssistantTab } from './assistant/AssistantPanel';
import SessionControls from './controls/SessionControls';
import DocumentPanel from '@/components/setup/documents/DocumentPanel';
import MeetingUsageCost from './header/MeetingUsageCost';
import Glossary from './header/Glossary';
export default function MeetingScreen({
  store,
  meeting,
  onRecords,
}: {
  store: SessionStore;
  meeting: Meeting;
  onRecords: () => void;
}) {
  const dismiss = useDialogDismiss();
  const { t } = useI18n();
  const session = store.session!;
  const elapsed =
    session.meetingStartedAt && session.meetingLastAt
      ? Math.floor(
          (Date.parse(session.meetingLastAt) - Date.parse(session.meetingStartedAt)) / 1000,
        )
      : 0;
  const documents = useRef<HTMLDialogElement>(null);
  const [documentsUpdating, setDocumentsUpdating] = useState(false);
  const [layout, setLayout] = useState('split');
  const [assistantTab, setAssistantTab] = useState<AssistantTab>('topics');
  useEffect(() => {
    const stop = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) meeting.pause();
    };
    window.addEventListener('keydown', stop);
    return () => window.removeEventListener('keydown', stop);
  }, [meeting]);
  return (
    <>
      <div className="meeting-header">
        <h1 title={session.title}>{session.title}</h1>
        <Glossary session={session} />
        <button
          type="button"
          className="meeting-docs-button"
          aria-label={t('資料')}
          title={documentsUpdating ? t('資料を更新しています…') : t('資料')}
          aria-busy={documentsUpdating}
          aria-haspopup="dialog"
          disabled={documentsUpdating}
          onClick={() => documents.current?.showModal()}
        >
          {documentsUpdating ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <FileText size={16} aria-hidden="true" />
          )}
          {t('{count}ファイル', { count: session.documents.length })}
        </button>
        <div className="meeting-header-meta">
          <MeetingUsageCost key={session.id} sessionId={session.id} onError={meeting.setError} />
          <span className="elapsed" title={t('最初の発言から最後の発言までの記録範囲です。')}>
            <Clock3 size={14} aria-hidden="true" />
            {t('記録範囲')} {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </span>
          <div className="meeting-layout" role="group" aria-label={t('表示の切り替え')}>
            {[
              { id: 'chat', label: 'Talkのみ', icon: PanelLeft },
              { id: 'split', label: 'TalkとAnalyze（6:4）', icon: Columns2 },
              { id: 'analyze', label: 'Analyzeのみ', icon: PanelRight },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="icon-button"
                aria-label={t(label)}
                title={t(label)}
                aria-pressed={layout === id}
                onClick={() => setLayout(id)}
              >
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <dialog
        {...dismiss}
        ref={documents}
        className="settings-dialog meeting-documents"
        aria-label={t('資料')}
      >
        <div className="section-heading">
          <h2>
            {t('資料')} ({session.documents.length})
          </h2>
          <button
            className="icon-button"
            aria-label={t('閉じる')}
            onClick={() => documents.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <ErrorBanner message={meeting.error} />
        <DocumentPanel
          store={store}
          onError={meeting.setError}
          onUploadingChange={(updating) => {
            setDocumentsUpdating(updating);
            if (updating) documents.current?.close();
          }}
        />
      </dialog>
      <div aria-label={t('会議の操作')} className="meeting-grid" data-layout={layout}>
        <fieldset className="meeting-left" disabled={session.status !== 'active'}>
          <ConversationPanel session={session} meeting={meeting} />
        </fieldset>
        <AssistantPanel
          store={store}
          meeting={meeting}
          tab={assistantTab}
          onTabChange={setAssistantTab}
        />
      </div>
      <SessionControls
        session={session}
        meeting={meeting}
        onRecords={onRecords}
        documentsUpdating={documentsUpdating}
      />
    </>
  );
}
