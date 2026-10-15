'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Language } from '@/lib/session/schema';
import type { SessionStore } from './useSessionStore';
export function useConsultation(store: SessionStore, onError: (message: string) => void) {
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{ id: string; reply: string } | null>(null);
  const current = useRef<{ abort: AbortController; id: string } | null>(null);
  const { ref, command } = store;
  const cancel = useCallback(() => {
    const request = current.current;
    current.current = null;
    request?.abort.abort();
    if (request) void command({ type: 'chat-failed', id: request.id }).catch(() => {});
    setPending(false);
    setDraft(null);
  }, [command]);
  const send = useCallback(
    async (text: string, language: Language, retryId?: string) => {
      const session = ref.current;
      if (!session || current.current || !text.trim()) return;
      const id = retryId || crypto.randomUUID();
      const abort = new AbortController();
      current.current = { abort, id };
      setPending(true);
      setDraft({ id, reply: '' });
      onError('');
      try {
        await command(
          { type: 'chat-start', id, text: text.trim(), retry: !!retryId },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        const result = await api<{ reply: string }>(
          `/api/sessions/${session.id}/consult`,
          {
            method: 'POST',
            body: JSON.stringify({ chatId: id, language }),
            signal: abort.signal,
          },
          (reply) => {
            if (
              current.current?.abort === abort &&
              !abort.signal.aborted &&
              ref.current?.id === session.id
            )
              setDraft({ id, reply });
          },
        );
        if (abort.signal.aborted || ref.current?.id !== session.id) return;
        await command({ type: 'chat-result', id, reply: result.reply }, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) {
          await command({ type: 'chat-failed', id }).catch(() => {});
          onError(error instanceof Error ? error.message : '相談への回答を取得できませんでした。');
        }
      } finally {
        if (current.current?.abort === abort) {
          current.current = null;
          setPending(false);
          setDraft(null);
        }
      }
    },
    [ref, command, onError],
  );
  useEffect(() => cancel, [cancel]);
  return { send, cancel, pending, draft };
}
