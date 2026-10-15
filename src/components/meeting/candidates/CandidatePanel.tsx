import { matchesTranscript } from '@/lib/session/refinement';
import { useI18n } from '@/components/settings/LanguageProvider';
import { Sparkles } from 'lucide-react';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Meeting } from '@/hooks/useMeeting';
import Button from '@/components/ui/Button';
import CandidateCard from './CandidateCard';
import AskComposer from './AskComposer';
import PromptChips from '../chat/PromptChips';
import { useState } from 'react';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
export default function CandidatePanel({
  store,
  meeting,
}: {
  store: SessionStore;
  meeting: Meeting;
}) {
  const { t } = useI18n();
  const [request, setRequest] = useState<{ text: string; createdAt: string } | null>(null);
  const session = store.session!;
  const g = meeting.generation;
  const candidates = session.candidates.filter(
    (c) => c.id === meeting.speechCandidateId || (!g.generating && c.status === 'ready'),
  );
  const question = session.transcripts.find((t) => matchesTranscript(t, g.targetId));
  const prompts = meeting.analyze.suggestions?.suggestedMeetingQuestions ?? [];
  async function generate(text: string) {
    if (g.generating || session.status !== 'active') return;
    const createdAt = new Date().toISOString();
    const success = await g.generate(undefined, text);
    if (success) setRequest({ text, createdAt });
    return success;
  }
  return (
    <section className="candidate-panel">
      {question && (
        <div className="target-question">
          <span>{t('選択中の発言')}</span>
          <p>{question.translation || question.text}</p>
        </div>
      )}
      <div className="candidate-scroll">
        {request && (
          <div className="ask-request-message">
            <time className="message-time" dateTime={request.createdAt}>
              {formatTranscriptTime(request.createdAt)}
            </time>
            <p className="ask-request">{request.text}</p>
          </div>
        )}
        {g.generating && (
          <div className="thinking-state" role="status">
            <span className="thinking-symbol">
              <Sparkles size={24} />
            </span>
            <strong className="thinking-label">{t('考え中…')}</strong>
            <p>{t('会話と資料から、伝え方を整えています。')}</p>
            <Button small variant="ghost" onClick={g.cancel}>
              {t('生成を取り消す')}
            </Button>
          </div>
        )}
        {candidates.length > 0 ? (
          <div className="candidate-list">
            {candidates.map((c, i) => (
              <CandidateCard
                key={c.id}
                index={i}
                candidate={c}
                language={session.settings.language}
                playback={c.id === meeting.speechCandidateId ? meeting.speaking : 'idle'}
                disabled={
                  session.status !== 'active' ||
                  (g.generating && c.id !== meeting.speechCandidateId)
                }
                onSpeech={() => {
                  if (c.id !== meeting.speechCandidateId) meeting.speakCandidate(c.id);
                  else if (meeting.speaking === 'paused') meeting.resume();
                  else meeting.pause();
                }}
                onEdit={(spokenText) =>
                  store.update((s) => ({
                    ...s,
                    candidates: s.candidates.map((x) =>
                      x.id === c.id
                        ? {
                            ...x,
                            spokenText,
                            text:
                              (x.translationLanguage ?? 'ja') === s.settings.language
                                ? spokenText
                                : '',
                          }
                        : x,
                    ),
                  }))
                }
              />
            ))}
          </div>
        ) : !g.generating ? (
          <div className="empty-state">
            <p>{t('伝えたいことを、下の欄に入力してください。')}</p>
          </div>
        ) : null}
        {g.note && !g.generating && <p className="generation-note">{t(g.note)}</p>}
      </div>
      <div className="chat-bottom">
        {prompts.length > 0 && (
          <PromptChips
            prompts={prompts}
            disabled={g.generating || session.status !== 'active'}
            onSelect={(text) => void generate(text)}
          />
        )}
        <AskComposer disabled={g.generating || session.status !== 'active'} onSend={generate} />
      </div>
    </section>
  );
}
