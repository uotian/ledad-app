'use client';
import { useEffect, useMemo, useState } from 'react';
import { SessionPersistence } from '@/lib/session/persistence';
import { languageStorageKey, parseLanguage } from '@/lib/i18n';
import { useI18n } from '@/components/settings/LanguageProvider';
import type { Session } from '@/lib/session/schema';
export function useSessionStore(id?: string) {
  const { language } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const persistence = useMemo(
    () => new SessionPersistence(id, { session: setSession, error: setError, saving: setSaving }),
    [id],
  );
  useEffect(() => {
    persistence.attach();
    return persistence.detach;
  }, [persistence]);
  useEffect(() => {
    let initialLanguage = language;
    try {
      initialLanguage = parseLanguage(localStorage.getItem(languageStorageKey));
    } catch {
      // 保存領域を使えない場合は現在の表示言語を使います。
    }
    void persistence.load(initialLanguage).catch(() => {});
  }, [persistence, language]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (persistence.unsaved || persistence.ref.current?.status === 'active') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [persistence]);
  return {
    id: session?.id || id || '',
    session: !id || session?.id === id ? session : null,
    ref: persistence.ref,
    update: persistence.update,
    flush: persistence.flush,
    ensureSaved: persistence.ensureSaved,
    command: persistence.command,
    prepareDocuments: persistence.prepareDocuments,
    error,
    saving,
    persisted: persistence.saved,
    reload: persistence.load,
  };
}
export type SessionStore = ReturnType<typeof useSessionStore>;
