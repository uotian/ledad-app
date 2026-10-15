// 音声なしE2E専用。通常開発・本番アプリからは呼び出しません。
'use client';
import { useEffect, useState } from 'react';
import { PencilLine, Send } from 'lucide-react';
import { useI18n } from '@/components/settings/LanguageProvider';
import type { Meeting } from '@/hooks/useMeeting';
export default function TestTranscriptInput({
  onAdd,
  onPreview,
  onReview,
}: {
  onAdd: Meeting['addTranscript'];
  onReview: Meeting['reviewAudio'];
  onPreview: (text: string) => void;
}) {
  useEffect(() => {
    const abort = new AbortController();
    const review = (event: Event) => {
      const detail = (event as CustomEvent<{ transcriptIds: string[] }>).detail;
      void onReview(
        { pcm: new Uint8Array(3200), transcriptIds: detail.transcriptIds },
        abort.signal,
      ).catch(() => {});
    };
    const finalize = (event: Event) => {
      const { text } = (event as CustomEvent<{ text: string }>).detail;
      onPreview('');
      onAdd(text, 'microphone', undefined, true);
    };
    window.addEventListener('ledad:test-review', review);
    window.addEventListener('ledad:test-final-transcript', finalize);
    return () => {
      abort.abort();
      window.removeEventListener('ledad:test-review', review);
      window.removeEventListener('ledad:test-final-transcript', finalize);
    };
  }, [onReview, onAdd, onPreview]);
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  return (
    <div className="manual-transcript">
      <button className="text-button" onClick={() => setManualOpen((v) => !v)}>
        <PencilLine size={13} />
        {t('会話を手入力で追加')}
      </button>
      {manualOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onPreview('');
            onAdd(text, 'manual');
            setText('');
          }}
        >
          <button type="button" className="text-button" onClick={() => onPreview(text)}>
            Preview transcription
          </button>
          <textarea
            aria-label={t('会話を手入力')}
            value={text}
            maxLength={20_000}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('聞き取れなかった発言を補う…')}
          />
          <button className="icon-button" aria-label={t('会話を追加')} disabled={!text.trim()}>
            <Send size={16} />
          </button>
        </form>
      )}
    </div>
  );
}
