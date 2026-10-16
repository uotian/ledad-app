'use client';
import { matchesTranscript } from '@/lib/session/refinement';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useRef } from 'react';
import type { Session } from '@/lib/session/schema';
import { formatTranscript, formatTranscriptTime } from '@/lib/session/transcript-display';
import type { Meeting } from '@/hooks/useMeeting';
import TranscriptItem from './TranscriptItem';
import TestTranscriptInput from './TestTranscriptInput';
export default function ConversationPanel({
  session,
  meeting,
}: {
  session: Session;
  meeting: Meeting;
}) {
  const { t } = useI18n();
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const container = end.current?.parentElement;
    if (container && following.current) container.scrollTo({ top: container.scrollHeight });
  }, [session.transcripts, meeting.interim, meeting.interimTranslation]);
  return (
    <section className="card conversation-panel" aria-label={t('会話の流れ')}>
      <div
        className="transcript-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {!session.transcripts.length && !meeting.interim && (
          <div className="empty-state">
            <p>{t('文字起こしと翻訳がここに表示されます。')}</p>
          </div>
        )}
        {session.transcripts
          .filter((t) => t.text.trim())
          .map((t) => (
            <TranscriptItem
              key={t.id}
              item={t}
              language={meeting.translationLanguage}
              active={matchesTranscript(t, meeting.generation.targetId)}
              pendingTranslation={meeting.pendingTranslations[t.id]}
            />
          ))}
        {meeting.interim && (
          <article
            key={meeting.interimId}
            data-transcript-id={meeting.interimId}
            className={`transcript-item interim-transcript ${meeting.interimTranslation ? 'has-translation' : ''}`}
          >
            <div className="transcript-meta">
              <time dateTime={meeting.interimTimestamp}>
                {formatTranscriptTime(meeting.interimTimestamp)}
              </time>
              <strong>Live</strong>
            </div>
            <p>{formatTranscript(meeting.interim)}</p>
            {meeting.interimTranslation && (
              <p className="transcript-translation" lang={meeting.translationLanguage}>
                {formatTranscript(meeting.interimTranslation)}
              </p>
            )}
          </article>
        )}
        <div ref={end} />
      </div>
      {process.env.NODE_ENV === 'development' &&
        process.env.NEXT_PUBLIC_LEDAD_DISABLE_AUDIO_CAPTURE === '1' && (
          <TestTranscriptInput
            onAdd={meeting.addTranscript}
            onPreview={meeting.previewTranscript}
            onReview={meeting.reviewAudio}
          />
        )}
    </section>
  );
}
