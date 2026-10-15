'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Language } from '@/lib/session/schema';
import { startAnalyzeSchedule } from './schedule';
import { api, ApiError } from '@/lib/api';
import { reportMeetingError } from '@/lib/report-meeting-error';
import { useProfile } from '@/components/settings/profile/useProfile';
import { useAnalyzeInterval } from '@/components/settings/analyze-interval';
import {
  conversationForAnalyze,
  mentionsKey,
  mentionAnalysisSchema,
  reconcileMentions,
  visibleMentions,
  type MentionAnalysis,
} from '@/lib/session/analyze';

export function useMentions(store: SessionStore, language: Language) {
  const profile = useProfile();
  const interval = useAnalyzeInterval();
  const intervalRef = useRef(interval);
  const profileKey = JSON.stringify(profile);
  const { id, ref, update } = store;
  const active = store.session?.status === 'active' && !!profile.name;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const schedule = useRef<ReturnType<typeof startAnalyzeSchedule> | null>(null);
  // 翻訳や保存状態の更新では再取得せず、解析に使う会話の変化だけを通知します。
  const conversation = store.session ? conversationForAnalyze(store.session) : [];
  const conversationKey = JSON.stringify(conversation);
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
      const abort = new AbortController();
      controller.current = abort;
      try {
        const inputKey = await mentionsKey(conversation, profileKey, language);
        if (abort.signal.aborted || session.mentionAnalysis?.inputKey === inputKey) return;
        setPending(true);
        setError('');
        const result = mentionAnalysisSchema.parse(
          await api<MentionAnalysis>(`/api/sessions/${id}/mentions`, {
            method: 'POST',
            signal: abort.signal,
            body: JSON.stringify({
              conversation,
              profile: JSON.parse(profileKey),
              language,
              previous: session.mentionAnalysis ?? null,
            }),
          }),
        );
        const latest = ref.current;
        // 解析中の追加・訂正は次の更新でAIへ渡します。
        if (abort.signal.aborted || !alive || latest?.id !== id || latest.status !== 'active')
          return;
        // 会話も結果も自動保存に任せ、解析は保存の完了を待ちません。
        update((value) => ({
          ...value,
          mentionAnalysis: reconcileMentions(result, conversation, conversationForAnalyze(value)),
        }));
        return 'sent';
      } catch (error) {
        if (alive && !abort.signal.aborted) {
          const message =
            error instanceof ApiError ? error.message : '言及を確認できませんでした。';
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
    const currentSchedule = startAnalyzeSchedule(refresh, () => intervalRef.current * 1000);
    schedule.current = currentSchedule;
    return () => {
      alive = false;
      currentSchedule.stop();
      schedule.current = null;
      cancel();
    };
  }, [active, id, language, profileKey, ref, update, cancel]);
  useEffect(() => {
    intervalRef.current = interval;
    const latestConversation = JSON.parse(conversationKey);
    if (!active) return;
    let cancelled = false;
    void mentionsKey(latestConversation, profileKey, language).then((key) => {
      if (!cancelled && ref.current?.mentionAnalysis?.inputKey !== key) schedule.current?.request();
    });
    return () => {
      cancelled = true;
    };
  }, [active, id, language, profileKey, conversationKey, interval, ref, update, cancel]);
  const result = store.session?.mentionAnalysis;
  const legacy = result ? null : store.session?.analyze;
  const source = result ?? legacy;
  const mentions =
    store.session && source?.profileKey === profileKey && source.language === language
      ? visibleMentions(store.session, source.mentions).filter((item) => {
          if (legacy) return true;
          const entry = conversation.find((entry) => entry.id === item.evidenceId);
          return entry?.text.includes(item.quote);
        })
      : [];
  return {
    pending,
    error,
    profile,
    mentions,
    cancel,
    updatedAt:
      source?.profileKey === profileKey && source.language === language
        ? source.updatedAt
        : undefined,
  };
}
