import { useI18n } from '@/components/settings/LanguageProvider';
import { MessageSquare, Sparkles, ListTree, AtSign } from 'lucide-react';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Meeting } from '@/hooks/useMeeting';
import CandidatePanel from '../candidates/CandidatePanel';
import PrivateChat from '../chat/PrivateChat';
import TopicsPanel from '../analyze/TopicsPanel';
import ForYouPanel from '../for-you/ForYouPanel';
import AnalysisUpdatedAt from './AnalysisUpdatedAt';

export type AssistantTab = 'candidates' | 'topics' | 'for-you' | 'chat';

export default function AssistantPanel({
  store,
  meeting,
  tab,
  onTabChange,
}: {
  store: SessionStore;
  meeting: Meeting;
  tab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
}) {
  const { t } = useI18n();
  const session = store.session!;
  const updatedAt =
    tab === 'topics'
      ? session.analyze?.updatedAt
      : tab === 'for-you'
        ? meeting.mentions.updatedAt
        : undefined;
  const tabs = [
    { id: 'topics' as const, label: 'Topics', icon: ListTree },
    { id: 'for-you' as const, label: 'You', icon: AtSign },
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'candidates' as const, label: 'Ask', icon: Sparkles },
  ];
  return (
    <section className="card assistant-panel" aria-label={t('ledadのサポート')}>
      <div className="assistant-tabs" role="tablist" aria-label={t('サポートの切り替え')}>
        {tabs.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            id={`assistant-tab-${id}`}
            role="tab"
            aria-label={label}
            aria-selected={tab === id}
            aria-controls={`assistant-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onTabChange(id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              onTabChange(tabs[next].id);
              document.getElementById(`assistant-tab-${tabs[next].id}`)?.focus();
            }}
          >
            <Icon size={16} />
            {label}
            {id === 'for-you' && (
              <span
                className="assistant-tab-status"
                aria-label={t('言及 {count}件', { count: meeting.mentions.mentions.length })}
              >
                {meeting.mentions.mentions.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* 非表示でもマウントを保ち、相談の下書きや候補の編集状態を残します。 */}
      <div
        className="assistant-tabpanel"
        id="assistant-panel-candidates"
        role="tabpanel"
        aria-labelledby="assistant-tab-candidates"
        hidden={tab !== 'candidates'}
      >
        <CandidatePanel store={store} meeting={meeting} />
      </div>
      <div
        className="assistant-tabpanel"
        id="assistant-panel-topics"
        role="tabpanel"
        aria-labelledby="assistant-tab-topics"
        hidden={tab !== 'topics'}
      >
        <TopicsPanel active={tab === 'topics'} session={session} runtime={meeting.analyze} />
      </div>
      <div
        className="assistant-tabpanel"
        id="assistant-panel-for-you"
        role="tabpanel"
        aria-labelledby="assistant-tab-for-you"
        hidden={tab !== 'for-you'}
      >
        <ForYouPanel
          active={tab === 'for-you'}
          updatedAt={meeting.mentions.updatedAt}
          mentions={meeting.mentions.mentions}
          configured={!!meeting.mentions.profile.name}
          pending={meeting.mentions.pending}
          error={meeting.mentions.error}
        />
      </div>
      <div
        className="assistant-tabpanel"
        id="assistant-panel-chat"
        role="tabpanel"
        aria-labelledby="assistant-tab-chat"
        hidden={tab !== 'chat'}
      >
        <PrivateChat session={session} meeting={meeting} />
      </div>
      {updatedAt && <AnalysisUpdatedAt timestamp={updatedAt} />}
    </section>
  );
}
