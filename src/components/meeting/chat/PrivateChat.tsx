'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useAutoResizeTextarea } from '@/hooks/useAutoResizeTextarea';
import type { Session } from '@/lib/session/schema';
import type { Meeting } from '@/hooks/useMeeting';
import ChatMessage from './ChatMessage';
import PromptChips from './PromptChips';
export default function PrivateChat({ session, meeting }: { session: Session; meeting: Meeting }) {
  const { t, language } = useI18n();
  const [text, setText] = useState('');
  const [draftPrompts, setDraftPrompts] = useState<string[] | null>(null);
  const input = useAutoResizeTextarea(text);
  const composing = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const container = end.current?.parentElement;
    if (container && following.current) container.scrollTo({ top: container.scrollHeight });
  }, [session.chats, meeting.consultation.draft?.reply]);
  function send(value: string) {
    if (!value.trim() || meeting.consultation.pending) return;
    following.current = true;
    void meeting.consultation.send(value, language);
    setText('');
  }
  const latestPrompts = meeting.analyze.suggestions?.suggestedQuestions ?? [
    t('今の話をかみ砕いて'),
    t('確認しておくべきことは？'),
    t('私が対応することは？'),
  ];
  const prompts = text ? (draftPrompts ?? latestPrompts) : latestPrompts;
  return (
    <section className="chat-panel">
      <div
        className="chat-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {session.chats.length === 0 && (
          <div className="empty-state">
            <p>{t('会議について聞きたいことを、下の欄に入力してください。')}</p>
          </div>
        )}
        {session.chats.map((c) => (
          <ChatMessage
            key={c.id}
            chat={c}
            draft={
              meeting.consultation.draft?.id === c.id ? meeting.consultation.draft.reply : undefined
            }
            onRetry={() => void meeting.consultation.send(c.text, language, c.id)}
            retryDisabled={meeting.consultation.pending}
          />
        ))}
        <div ref={end} />
      </div>
      <div className="chat-bottom">
        <PromptChips prompts={prompts} disabled={meeting.consultation.pending} onSelect={send} />
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            ref={input}
            aria-label={t('AIへの相談')}
            value={text}
            rows={1}
            maxLength={4000}
            placeholder={t('会議について質問する…')}
            onChange={(e) => {
              if (!text && e.target.value) setDraftPrompts(prompts);
              setText(e.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
                return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <button
            aria-label={t('相談を送信')}
            disabled={!text.trim() || meeting.consultation.pending}
          >
            <ArrowUp size={17} />
          </button>
        </form>
      </div>
    </section>
  );
}
