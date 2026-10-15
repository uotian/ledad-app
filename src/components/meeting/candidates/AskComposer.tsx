import { useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '@/components/settings/LanguageProvider';
import { useAutoResizeTextarea } from '@/hooks/useAutoResizeTextarea';

export default function AskComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const input = useAutoResizeTextarea(text);
  const composing = useRef(false);
  async function send() {
    if (disabled || !text.trim()) return;
    const sent = text;
    if (await onSend(sent)) setText((current) => (current === sent ? '' : current));
  }
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={input}
        aria-label={t('Askへの依頼')}
        placeholder={t('聞きたいこと・伝えたいことを入力…')}
        value={text}
        rows={1}
        maxLength={4000}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" aria-label={t('発言案を作る')} disabled={disabled || !text.trim()}>
        <ArrowUp size={17} />
      </button>
    </form>
  );
}
