import { useI18n } from '@/components/settings/LanguageProvider';
import type { Session } from '@/lib/session/schema';
import { formatTranscriptTime } from '@/lib/session/transcript-display';
import ChatReplyContent from './ChatReplyContent';
export default function ChatMessage({
  chat,
  draft,
  onRetry,
  retryDisabled,
}: {
  chat: Session['chats'][number];
  draft?: string;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const { t } = useI18n();
  const reply = chat.status === 'pending' ? draft : chat.reply;
  return (
    <div className="chat-turn">
      <div className="chat-message chat-user">
        <div className="chat-message-meta">
          <span>{t('あなた')}</span>
          <time className="message-time" dateTime={chat.createdAt}>
            {formatTranscriptTime(chat.createdAt)}
          </time>
        </div>
        <p>{chat.text}</p>
        {chat.kind === 'instruction' && <small>{t('以前の候補作成への指示')}</small>}
      </div>
      {chat.kind === 'consultation' && (
        <div
          className="chat-message chat-reply"
          aria-live="polite"
          aria-busy={chat.status === 'pending'}
        >
          <div className="chat-message-meta">
            <span>AI</span>
            {chat.reply && chat.repliedAt && (
              <time className="message-time" dateTime={chat.repliedAt}>
                {formatTranscriptTime(chat.repliedAt)}
              </time>
            )}
          </div>
          {reply && <ChatReplyContent text={reply} />}
          {chat.status === 'pending' && !reply && (
            <small role="status">{t('回答を考えています…')}</small>
          )}
          {chat.status === 'failed' && (
            <>
              <small>{t('回答を取得できませんでした。')}</small>
              <button className="text-button" disabled={retryDisabled} onClick={onRetry}>
                {t('再試行')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
