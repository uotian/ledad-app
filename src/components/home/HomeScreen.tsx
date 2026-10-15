'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { SessionSummary } from '@/lib/session/schema';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { useLoading } from '@/components/ui/Loading';
import Button from '@/components/ui/Button';
import SessionList from './SessionList';
import SettingsDialog from '@/components/settings/SettingsDialog';
import type { SessionStore } from '@/hooks/useSessionStore';
import type { Meeting } from '@/hooks/useMeeting';
import AudioSettings from '@/components/setup/AudioSettings';
import DocumentPanel from '@/components/setup/documents/DocumentPanel';
import AppName from '@/components/shell/AppName';
import { version } from '../../../package.json';

export default function HomeScreen({
  store,
  meeting,
  onStart,
  onReset,
}: {
  store: SessionStore;
  meeting: Meeting;
  onStart: () => Promise<void>;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const loading = useLoading();
  const { session, update } = store;
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const documents = useRef<HTMLDetailsElement>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [ready, setReady] = useState<{ openai: boolean; gemini: boolean } | null>(null);
  const [error, setError] = useState('');
  const busy = meeting.starting || uploading;
  const [deleting, setDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const fail = (error: Error) => {
      if (active) setError(error.message);
    };
    // 会議一覧はキーチェーンの応答を待たずに表示します。
    void api<SessionSummary[]>('/api/sessions')
      .then((value) => {
        if (active) setSessions(value);
      })
      .catch(fail);
    void api<{ openai: boolean; gemini: boolean }>('/api/config')
      .then((value) => {
        if (active) setReady(value);
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, []);
  async function open(id: string) {
    if (busy || deleting) return;
    return loading.run(async () => {
      try {
        await meeting.prepareClose();
        router.push(`/session/?id=${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('会議を保存できませんでした。'));
      }
    });
  }
  async function remove(ids?: string[]) {
    if (deleting || busy) return;
    return loading.run(async () => {
      try {
        await store.flush();
        if (!ids) ids = (await api<SessionSummary[]>('/api/sessions')).map((s) => s.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('削除できませんでした。'));
        return;
      }
      if (!ids.length) return;
      // 現在の下書きは最後に削除し、途中失敗時にも編集を続けられるようにします。
      ids = [...ids.filter((id) => id !== store.id), ...ids.filter((id) => id === store.id)];
      if (
        !window.confirm(
          t(
            '{count}件の会議と登録資料・記録をこのMacから削除します。この操作は取り消せません。よろしいですか？',
            { count: ids.length },
          ),
        )
      )
        return;
      setDeleting(true);
      setError('');
      try {
        for (const id of ids) {
          await api(`/api/sessions/${id}`, { method: 'DELETE' });
          setSessions((s) => s.filter((x) => x.id !== id));
        }
        if (ids.includes(store.id)) onReset();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('削除できませんでした。'));
      } finally {
        setDeleting(false);
      }
    });
  }
  return (
    <>
      {settingsOpen && (
        <SettingsDialog
          initialTab="keys"
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            void api<{ openai: boolean; gemini: boolean }>('/api/config')
              .then(setReady)
              .catch((e) => setError(e.message));
          }}
        />
      )}
      <div className="page-header">
        <h1 className="home-heading">
          <span className="home-app-info">
            <AppName />
            <span className="app-version">v{version}</span>
          </span>
        </h1>
        <button
          className="connection-status connection-button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('AI接続設定を開く')}
        >
          <span
            className={`status-dot ${ready?.openai && ready?.gemini ? '' : 'status-dot-muted'}`}
          />
          {!ready
            ? t('設定を確認中')
            : ready.openai && ready.gemini
              ? t('AIキー設定済み')
              : t('APIキーの設定が必要です')}
        </button>
      </div>
      <ErrorBanner message={error} />
      {!session ? (
        <div className="loading-screen">
          {store.error ? (
            <Button onClick={() => void store.reload().catch(() => {})}>{t('再試行')}</Button>
          ) : (
            t('準備しています…')
          )}
        </div>
      ) : (
        <fieldset className="home-preparation" disabled={busy || deleting}>
          <section className="card setup-card">
            <label className="field">
              {t('タイトル')}
              <input
                value={session.title}
                maxLength={120}
                onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
                onBlur={(e) => {
                  if (!e.target.value.trim()) update((s) => ({ ...s, title: t('新しい会議') }));
                }}
                placeholder={t('例：検索基盤の改善提案')}
              />
            </label>
            <AudioSettings
              settings={session.settings}
              onChange={(settings) => update((s) => ({ ...s, settings }))}
            />
            <details className="home-documents" ref={documents}>
              <summary>
                {t('資料の追加')}
                {session.documents.length > 0 && <span>{session.documents.length}</span>}
              </summary>
              <DocumentPanel
                store={store}
                onError={meeting.setError}
                onUploadingChange={(uploading) => {
                  setUploading(uploading);
                  if (uploading && documents.current) documents.current.open = true;
                }}
              />
            </details>
            <Button variant="primary" className="home-start" onClick={onStart}>
              {meeting.starting ? t('音声に接続しています…') : t('会議を始める')}
              <ArrowRight size={17} />
            </Button>
          </section>
        </fieldset>
      )}
      <SessionList
        sessions={
          store.persisted && session && !sessions.some((s) => s.id === session.id)
            ? [...sessions, { ...session, hasMinutes: !!session.minutes }]
            : sessions
        }
        onOpen={open}
        deleting={deleting}
        disabled={busy || deleting}
        onDelete={(id) => remove([id])}
        onDeleteAll={() => remove()}
      />
    </>
  );
}
