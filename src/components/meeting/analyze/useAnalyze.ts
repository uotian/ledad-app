'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Language } from '@/lib/session/schema';
import { documentsFor } from '@/lib/session/policy';
import { glossaryEntries } from '@/lib/session/glossary';
import { startAnalyzeSchedule } from './schedule';
import { api, ApiError } from '@/lib/api';
import { reportMeetingError } from '@/lib/report-meeting-error';
import { useProfile } from '@/components/settings/profile/useProfile';
import { useAnalyzeInterval } from '@/components/settings/analyze-interval';
import {
  conversationForAnalyze,
  analyzeKey,
  analyzeSchema,
  previousAnalyze,
  reconcileMentions,
  visibleMentions,
  type Analyze,
} from '@/lib/session/analyze';

export function useAnalyze(store: SessionStore, language: Language) {
  const profile = useProfile();
  const interval = useAnalyzeInterval();
  const intervalRef = useRef(interval);
  const profileKey = JSON.stringify(profile);
  const { id, ref, update } = store;
  const active = store.session?.status === 'active';
  const [pending, setPending] = useState(false);
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  useEffect(() => {
    const tick = () =>
      setRemainingSeconds(
        waitingUntil === null ? null : Math.max(0, Math.ceil((waitingUntil - Date.now()) / 1000)),
      );
    tick();
    if (waitingUntil === null) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [waitingUntil]);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const schedule = useRef<ReturnType<typeof startAnalyzeSchedule> | null>(null);
  // 翻訳や保存状態の更新では再取得せず、解析に使う会話の変化だけを通知します。
  const conversation = store.session ? conversationForAnalyze(store.session) : [];
  const conversationKey = JSON.stringify(conversation);
  const documentsKey = JSON.stringify(documentsFor(store.session));
  const reservedKey = JSON.stringify(
    store.session
      ? glossaryEntries(store.session, profile)
          .filter((entry) => entry.source !== 'analyze')
          .map((entry) => entry.term)
      : [],
  );
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
  }, []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    async function refresh(): Promise<void | 'sent' | 'retry'> {
      const session = ref.current;
      if (!alive || controller.current || session?.id !== id || session.status !== 'active') return;
      const conversation = conversationForAnalyze(session);
      if (!conversation.length) return;
      const abort = new AbortController();
      controller.current = abort;
      try {
        const inputKey = await analyzeKey(
          conversation,
          profileKey,
          language,
          JSON.parse(documentsKey),
          JSON.parse(reservedKey),
        );
        if (abort.signal.aborted || session.analyze?.inputKey === inputKey) return;
        setPending(true);
        setError('');
        const result = analyzeSchema.parse(
          await api<Analyze>(`/api/sessions/${id}/analyze`, {
            method: 'POST',
            signal: abort.signal,
            body: JSON.stringify({
              conversation,
              profile: JSON.parse(profileKey),
              language,
              previous: previousAnalyze(session),
            }),
          }),
        );
        const latest = ref.current;
        // 解析中の追加・訂正は次の更新でAIへ渡します。
        if (abort.signal.aborted || !alive || latest?.id !== id || latest.status !== 'active')
          return;
        // 会話も結果も自動保存に任せ、解析は保存の完了を待ちません。
        update((value) => {
          const current = conversationForAnalyze(value);
          const settled = new Map(
            current.filter((item) => item.settled).map((item) => [item.id, item.text]),
          );
          return {
            ...value,
            analyze: {
              ...reconcileMentions(result, conversation, current),
              glossary: result.glossary.filter((entry) =>
                settled.get(entry.evidenceId)?.includes(entry.term),
              ),
            },
            mentionAnalysis: null,
          };
        });
        return 'sent';
      } catch (error) {
        if (alive && !abort.signal.aborted) {
          const message =
            error instanceof ApiError ? error.message : '会話分析を更新できませんでした。';
          setError(message);
          void reportMeetingError(id, message, new Date().toISOString());
          return 'retry';
        }
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          if (alive) setPending(false);
        }
      }
    }
    const currentSchedule = startAnalyzeSchedule(
      refresh,
      () => intervalRef.current * 1000,
      setWaitingUntil,
    );
    schedule.current = currentSchedule;
    return () => {
      alive = false;
      currentSchedule.stop();
      schedule.current = null;
      cancel();
    };
  }, [active, id, language, profileKey, documentsKey, reservedKey, ref, update, cancel]);
  useEffect(() => {
    intervalRef.current = interval;
    const latestConversation = JSON.parse(conversationKey);
    if (!active || !latestConversation.length) return;
    let cancelled = false;
    void analyzeKey(
      latestConversation,
      profileKey,
      language,
      JSON.parse(documentsKey),
      JSON.parse(reservedKey),
    ).then((key) => {
      if (!cancelled && ref.current?.analyze?.inputKey !== key) schedule.current?.request();
    });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    id,
    language,
    profileKey,
    conversationKey,
    documentsKey,
    reservedKey,
    interval,
    ref,
    update,
    cancel,
  ]);
  const analyze = store.session?.analyze;
  const suggestions =
    analyze?.language === language && analyze.profileKey === profileKey ? analyze : null;
  const mentionSource = store.session?.mentionAnalysis ?? analyze;
  const matching = mentionSource?.profileKey === profileKey && mentionSource.language === language;
  const mentions =
    store.session && matching
      ? visibleMentions(store.session, mentionSource.mentions).filter((item) =>
          conversation.some(
            (entry) => entry.id === item.evidenceId && entry.text.includes(item.quote),
          ),
        )
      : [];
  return {
    pending,
    remainingSeconds,
    error,
    profile,
    suggestions,
    cancel,
    mentions,
    mentionUpdatedAt: matching ? mentionSource.updatedAt : undefined,
  };
}
export type AnalyzeRuntime = ReturnType<typeof useAnalyze>;
