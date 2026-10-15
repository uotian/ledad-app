'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Candidate } from '@/lib/session/schema';
import type { SessionStore } from './useSessionStore';
type Result = {
  note: string;
  candidates: Pick<
    Candidate,
    'title' | 'text' | 'spokenText' | 'translationLanguage' | 'caution'
  >[];
};
export function useCandidateGeneration(store: SessionStore, onError: (message: string) => void) {
  const [generating, setGenerating] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const controller = useRef<AbortController | null>(null);
  const { ref, command, flush } = store;
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setGenerating(false);
  }, []);
  const generate = useCallback(
    async (questionId?: string | null, instruction = '') => {
      const session = ref.current;
      if (!session) return;
      cancel();
      const abort = new AbortController();
      controller.current = abort;
      const target = questionId === undefined ? targetId : questionId;
      setTargetId(target);
      setGenerating(true);
      setNote('');
      try {
        await flush();
        if (abort.signal.aborted) return;
        const result = await api<Result>(`/api/sessions/${session.id}/generate`, {
          method: 'POST',
          body: JSON.stringify({ targetId: target, instruction: instruction.trim() }),
          signal: abort.signal,
        });
        if (abort.signal.aborted || ref.current?.id !== session.id) return;
        await command(
          { type: 'candidates', targetId: target, candidates: result.candidates },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setNote(result.note);
        return true;
      } catch (error) {
        if (abort.signal.aborted) return;
        onError(error instanceof Error ? error.message : '候補を作成できませんでした。');
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setGenerating(false);
        }
      }
    },
    [cancel, command, flush, onError, ref, targetId],
  );
  useEffect(() => () => controller.current?.abort(), []);
  return {
    generating,
    targetId,
    note,
    generate,
    cancel,
  };
}
