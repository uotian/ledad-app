'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { LiveTranslation } from '@/lib/session/live-translation';
import type { Language } from '@/lib/session/schema';
export function useInterimTranslation(
  text: string,
  language: Language,
  active: boolean,
  sessionId: string,
  utteranceId: string,
) {
  const latest = useRef<{ text: string; key: string; sourceText: string } | null>(null);
  const worker = useRef<LiveTranslation | null>(null);
  const workerKey = useRef('');
  const discard = useCallback(
    (usageId: string) => {
      void api(`/api/sessions/${sessionId}/usage/${usageId}/unused`, { method: 'POST' }).catch(
        () => {},
      );
    },
    [sessionId],
  );
  const takeTranslation = useCallback(
    (
      sessionId: string,
      utteranceId: string,
      language: Language,
      sourceText: string,
      completeUtterance = false,
    ) => {
      const expectedKey = `${sessionId}:${utteranceId}:${language}`;
      const result = latest.current;
      latest.current = null;
      const pending =
        workerKey.current === expectedKey
          ? worker.current?.handoff(sourceText, completeUtterance)
          : null;
      return {
        text:
          result?.key === expectedKey &&
          (completeUtterance ||
            (!!result.sourceText && sourceText.trim().startsWith(result.sourceText)))
            ? result.text
            : '',
        pending,
      };
    },
    [],
  );
  const [result, setResult] = useState<{ text: string; key: string }>({
    text: '',
    key: '',
  });
  const [pendingRequests, setPendingRequests] = useState(0);
  const key = `${sessionId}:${utteranceId}:${language}`;
  useEffect(() => {
    if (!active || !utteranceId) return;
    const translator = new LiveTranslation(
      language,
      async (text, translationLanguage, previous) => {
        setPendingRequests((count) => count + 1);
        try {
          const result = await api<{ translation: string; usageId: string }>(
            `/api/sessions/${sessionId}/translate-transcript`,
            {
              method: 'POST',
              body: JSON.stringify({ text, translationLanguage, previous }),
            },
          );
          return { text: result.translation, usageId: result.usageId };
        } finally {
          setPendingRequests((count) => count - 1);
        }
      },
      (text, sourceText) => {
        latest.current = { text, key, sourceText };
        setResult({ text, key });
      },
      discard,
    );
    worker.current = translator;
    workerKey.current = key;
    return () => {
      translator.reset();
      if (worker.current === translator) {
        worker.current = null;
        workerKey.current = '';
      }
    };
  }, [language, active, sessionId, utteranceId, key, discard]);
  useEffect(() => {
    worker.current?.update(text);
  }, [text, language, active, sessionId, utteranceId]);
  return {
    translation: active && text && result.key === key ? result.text : '',
    takeTranslation,
    pending: pendingRequests > 0,
    discard,
  };
}
