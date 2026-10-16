'use client';
import { readProfile } from '@/components/settings/profile/profile';
import { documentsPending } from '@/lib/session/policy';
import type { Refinement } from '@/lib/session/refinement';
import type { AudioReview, ReviewProgress } from '@/lib/audio/review-buffer';
import { useInterimTranslation } from './useInterimTranslation';
import { useI18n } from '@/components/settings/LanguageProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { encodeBase64 } from '@/lib/base64';
import { reportMeetingError } from '@/lib/report-meeting-error';
import { MeetingListener, type ListeningStatus } from '@/lib/audio/listener';
import { MeetingSpeaker, type SpeakingStatus } from '@/lib/audio/speaker';
import type { Language, Minutes, Transcript } from '@/lib/session/schema';
import { useConsultation } from './useConsultation';
import { useCandidateGeneration } from './useCandidateGeneration';
import { useAnalyze } from '@/components/meeting/analyze/useAnalyze';
import type { SessionStore } from './useSessionStore';
export function useMeeting(store: SessionStore) {
  const errorSessionId = store.id;
  const [errorNotice, setErrorNotice] = useState({ message: '', occurredAt: '' });
  const setError = useCallback(
    (message: string) => {
      const occurredAt = message ? new Date().toISOString() : '';
      setErrorNotice({ message, occurredAt });
      if (message) void reportMeetingError(errorSessionId, message, occurredAt);
    },
    [errorSessionId],
  );
  const error = errorNotice.message;
  const { language } = useI18n();
  const analyze = useAnalyze(store, language);
  const selectedTranslationLanguage = store.session?.settings.translationLanguage ?? 'ja';
  const translationLanguage = useRef(selectedTranslationLanguage);
  useEffect(() => {
    translationLanguage.current = selectedTranslationLanguage;
  }, [selectedTranslationLanguage]);
  const [listening, setListening] = useState<ListeningStatus>('idle');
  const [fixProgress, setFixProgress] = useState<ReviewProgress>({ state: 'idle' });
  const [speaking, setSpeaking] = useState<SpeakingStatus>('idle');
  const [speechCandidateId, setSpeechCandidateId] = useState<string | null>(null);
  const [preview, setPreview] = useState({ text: '', id: '', timestamp: '' });
  const interimText = useRef('');
  const pendingPreviewId = useRef('');
  // 確定訳が届くまで表示する暫定訳。保存データには混ぜません。
  const [pendingTranslations, setPendingTranslations] = useState<
    Record<string, { text: string; language: Language }>
  >({});
  const pendingTimestamp = useRef<string | null>(null);
  const handleInterim = useCallback((text: string, startedAtHint?: string) => {
    const isNew = !!text && !interimText.current;
    if (isNew) pendingTimestamp.current = startedAtHint || new Date().toISOString();
    interimText.current = text;
    const id = isNew ? crypto.randomUUID() : '';
    if (isNew) pendingPreviewId.current = id;
    const timestamp = text ? pendingTimestamp.current || '' : '';
    setPreview((previous) => ({
      text,
      id: text ? id || previous.id : '',
      timestamp,
    }));
  }, []);
  const interim = preview.text;
  const {
    translation: interimTranslation,
    pending: translatingInterim,
    takeTranslation,
    discard,
  } = useInterimTranslation(
    interim,
    selectedTranslationLanguage,
    store.session?.status === 'active',
    store.id,
    preview.id,
  );
  const [level, setLevel] = useState(0);
  const [starting, setStarting] = useState(false);
  const startCancelled = useRef(false);
  const [ending, setEnding] = useState(false);
  const [stoppingListening, setStoppingListening] = useState(false);
  const stoppingInput = useRef(false);
  const stopping = useRef(false);
  const [summarizing, setSummarizing] = useState(false);
  useEffect(() => {
    const beforeConnectionChange = (event: Event) => {
      if (
        starting ||
        stoppingListening ||
        (listening !== 'idle' && listening !== 'error') ||
        speaking !== 'idle'
      )
        event.preventDefault();
    };
    window.addEventListener('ledad-before-connection-change', beforeConnectionChange);
    return () =>
      window.removeEventListener('ledad-before-connection-change', beforeConnectionChange);
  }, [starting, stoppingListening, listening, speaking]);
  const listener = useRef<MeetingListener | null>(null);
  const speaker = useRef<MeetingSpeaker | null>(null);
  const translationControllers = useRef(new Set<AbortController>());
  const [translating, setTranslating] = useState(0);
  const generation = useCandidateGeneration(store, setError);
  const consultation = useConsultation(store, setError);
  const { id: sessionId, ref, update, flush, ensureSaved, command } = store;
  const addTranscript = useCallback(
    (
      text: string,
      source?: Transcript['source'],
      startedAt?: string,
      completeUtterance = false,
    ) => {
      const timestamp = pendingTimestamp.current || startedAt || new Date().toISOString();
      const previewId = pendingPreviewId.current;
      pendingPreviewId.current = '';
      const targetLanguage = translationLanguage.current;
      const { text: pendingTranslation, pending } = takeTranslation(
        sessionId,
        previewId,
        targetLanguage,
        text,
        completeUtterance,
      );
      pendingTimestamp.current = null;
      const session = ref.current;
      if (!session || session.status !== 'active' || !text.trim()) {
        if (pending) void pending.then((result) => discard(result.usageId)).catch(() => {});
        return;
      }
      const id = previewId || crypto.randomUUID();
      const transcriptText = text.trim();
      if (pendingTranslation)
        setPendingTranslations((previous) => ({
          ...previous,
          [id]: { text: pendingTranslation, language: targetLanguage },
        }));
      update((s) => ({
        ...s,
        transcripts: [
          ...s.transcripts,
          {
            id,
            text: transcriptText,
            translation: '',
            timestamp,
            source: source || s.settings.input,

            analyzed: false,
            disposition: 'open',
          },
        ],
      }));
      if (pending)
        void pending
          .then((result) => {
            if (
              !result.text ||
              ref.current?.id !== sessionId ||
              ref.current.status !== 'active' ||
              translationLanguage.current !== targetLanguage ||
              !ref.current.transcripts.some(
                (t) => t.id === id && t.text === transcriptText && !t.analyzed && !t.correctedAt,
              )
            ) {
              discard(result.usageId);
              return;
            }
            setPendingTranslations((previous) => ({
              ...previous,
              [id]: { text: result.text, language: targetLanguage },
            }));
          })
          .catch(() => {});
      const abort = new AbortController();
      translationControllers.current.add(abort);
      setTranslating(translationControllers.current.size);
      void (async () => {
        if (abort.signal.aborted) return;
        try {
          await flush();
          const targetLanguage = translationLanguage.current;
          const result = await api<{ translation: string }>(
            `/api/sessions/${session.id}/translate`,
            {
              method: 'POST',
              body: JSON.stringify({ text: transcriptText, translationLanguage: targetLanguage }),
              signal: abort.signal,
            },
          );
          if (
            abort.signal.aborted ||
            ref.current?.id !== sessionId ||
            ref.current?.status !== 'active' ||
            !ref.current.transcripts.some(
              (t) => t.id === id && t.text === transcriptText && !t.correctedAt,
            )
          )
            return;
          update((s) => ({
            ...s,
            transcripts: s.transcripts.map((t) =>
              t.id === id && t.text === transcriptText && !t.correctedAt
                ? { ...t, ...result, translationLanguage: targetLanguage, analyzed: true }
                : t,
            ),
          }));
          setPendingTranslations((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
          });
        } catch (error) {
          if (!abort.signal.aborted)
            setError(error instanceof Error ? error.message : '発言の翻訳に失敗しました。');
        } finally {
          translationControllers.current.delete(abort);
          setTranslating(translationControllers.current.size);
        }
      })();
      return id;
    },
    [flush, ref, update, sessionId, takeTranslation, discard, setError],
  );
  const reviewAudio = useCallback(
    async (review: AudioReview, signal: AbortSignal) => {
      await flush();
      if (signal.aborted) return;
      const result = await api<Refinement>(`/api/sessions/${sessionId}/refine-transcripts`, {
        method: 'POST',
        body: JSON.stringify({
          pcm: encodeBase64(review.pcm),
          profile: readProfile(),
          transcriptIds: review.transcriptIds,
          translationLanguage: translationLanguage.current,
        }),
        signal,
      });
      if (signal.aborted || ref.current?.id !== sessionId) return;
      await command({ type: 'refinement', result, expectedIds: review.transcriptIds }, signal);
      setPendingTranslations((previous) => {
        const next = { ...previous };
        for (const item of result.originals) delete next[item.id];
        return next;
      });
      await flush();
    },
    [command, flush, ref, sessionId],
  );
  useEffect(() => {
    const input = new MeetingListener({
      onText: (text, startedAt, completeUtterance) =>
        addTranscript(text, undefined, startedAt, completeUtterance),
      onInterim: handleInterim,
      onReview: reviewAudio,
      onReviewProgress: setFixProgress,
      onStatus: (status) => {
        if (status !== 'listening' && status !== 'updating') {
          pendingTimestamp.current = null;
          pendingPreviewId.current = '';
        }
        setListening(status);
      },
      onError: setError,
      onLevel: setLevel,
    });
    const output = new MeetingSpeaker(
      {
        onStatus: (status) => {
          setSpeaking(status);
          setSpeechCandidateId(output.candidateId);
        },
        onError: setError,
        onRecord: (record) => {
          void command({ type: 'utterance', record }).catch((error) =>
            setError(error instanceof Error ? error.message : '会議を保存できませんでした。'),
          );
        },
      },
      sessionId,
    );
    listener.current = input;
    speaker.current = output;
    const controllers = translationControllers.current;
    return () => {
      startCancelled.current = true;
      void input.stop(false);
      output.stop();
      controllers.forEach((c) => c.abort());
    };
  }, [addTranscript, command, handleInterim, reviewAudio, sessionId, update, setError]);
  async function start() {
    if (stopping.current || stoppingInput.current) return;
    const session = ref.current;
    if (!session || session.minutes || session.status === 'ended') return;
    setError('');
    setStarting(true);
    startCancelled.current = false;
    pendingTimestamp.current = null;
    try {
      // 言語変更の自動保存を待ち、STTへ最新の設定を渡します。
      await ensureSaved();
      if (ref.current && documentsPending(ref.current)) await store.prepareDocuments();
      if (startCancelled.current) return;
      await listener.current?.start(session.settings, session.id);
      if (startCancelled.current) {
        await listener.current?.stop();
        return;
      }
      await command({ type: 'start' });
      await flush();
    } catch (error) {
      await listener.current?.stop();
      setError(error instanceof Error ? error.message : '会議を開始できませんでした。');
    } finally {
      setStarting(false);
    }
  }
  function speakCandidate(candidateId: string) {
    const session = ref.current;
    const candidate = session?.candidates.find(
      (c) =>
        c.id === candidateId &&
        (c.status === 'ready' ||
          c.status === 'spoken' ||
          session.utterances.some((u) => u.candidateId === c.id)),
    );
    if (!session || session.status !== 'active' || !candidate || generation.generating) return;
    setError('');
    // 押した時点の文章をコピーし、候補の更新とは独立した発話として固定します。
    speaker.current?.start(
      candidate.spokenText,
      session.settings,
      candidate.id,
      candidate.targetId,
    );
  }
  async function toggleListening() {
    if (ref.current?.minutes || ref.current?.status === 'ended') return;
    if (stopping.current || stoppingInput.current) return;
    if (listening === 'listening' || listening === 'connecting' || listening === 'updating') {
      stoppingInput.current = true;
      setStoppingListening(true);
      setError('');
      try {
        // 入力だけを停止し、回答生成・読み上げ・届いた音声の解析は続けます。
        await listener.current?.stop();
        await flush();
      } catch (error) {
        setError(error instanceof Error ? error.message : '会議を保存できませんでした。');
      } finally {
        stoppingInput.current = false;
        setStoppingListening(false);
      }
    } else if (ref.current) {
      setError('');
      pendingTimestamp.current = null;
      await listener.current?.start(ref.current.settings, ref.current.id).catch(() => {});
    }
  }
  async function createMinutes() {
    const session = ref.current;
    if (!session || session.minutes || summarizing) return;
    setSummarizing(true);
    setError('');
    try {
      await flush();
      const minutes = await api<Minutes>(`/api/sessions/${session.id}/minutes`, { method: 'POST' });
      await command({ type: 'minutes', minutes });
      await flush();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '議事録を作れませんでした。再試行してください。',
      );
    } finally {
      setSummarizing(false);
    }
  }
  function cancelActivities() {
    startCancelled.current = true;
    generation.cancel();
    consultation.cancel();
    analyze.cancel();
    translationControllers.current.forEach((controller) => controller.abort());
    speaker.current?.stop();
  }
  const processing =
    starting ||
    stoppingListening ||
    summarizing ||
    translating > 0 ||
    translatingInterim ||
    generation.generating ||
    consultation.pending ||
    analyze.pending ||
    fixProgress.state === 'processing' ||
    speaking === 'loading' ||
    speaking === 'speaking' ||
    store.saving;
  async function end() {
    if (
      stopping.current ||
      stoppingInput.current ||
      processing ||
      translationControllers.current.size
    )
      return false;
    stopping.current = true;
    setEnding(true);
    setError('');
    try {
      cancelActivities();
      // Appleの最後の訂正も、会議がactiveの間に記録します。
      await listener.current?.stop();
      await command({ type: 'end' });
      translationControllers.current.forEach((c) => c.abort());
      await flush();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '会議を保存できませんでした。');
      return false;
    } finally {
      setEnding(false);
      stopping.current = false;
    }
  }
  async function prepareClose() {
    stopping.current = true;
    cancelActivities();
    try {
      await listener.current?.stop();
      translationControllers.current.forEach((c) => c.abort());
      await flush();
    } finally {
      stopping.current = false;
    }
  }
  return {
    error,
    errorOccurredAt: errorNotice.occurredAt,
    setError,
    listening,
    fixProgress,
    speaking,
    interim,
    interimTimestamp: preview.timestamp,
    interimTranslation,
    translationLanguage: selectedTranslationLanguage,
    pendingTranslations,
    previewTranscript: handleInterim,
    interimId: preview.id,
    reviewAudio,
    level,
    starting,
    ending,
    stoppingListening,
    summarizing,
    processing,
    generation,
    consultation,
    analyze,
    start,
    end,
    prepareClose,
    createMinutes,
    addTranscript,
    speakCandidate,
    speechCandidateId,
    toggleListening,
    pause: () => speaker.current?.pause(),
    resume: () => speaker.current?.resume(),
  };
}
export type Meeting = ReturnType<typeof useMeeting>;
