'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/hooks/useSessionStore';
import { useMeeting } from '@/hooks/useMeeting';
import { LoadingProvider, useLoading } from './ui/Loading';
import AppShell from './shell/AppShell';
import ErrorBanner from './ui/ErrorBanner';
import HomeScreen from './home/HomeScreen';
import MeetingScreen from './meeting/MeetingScreen';
import RecordsScreen from './records/RecordsScreen';
export default function SessionWorkspace({ id }: { id?: string }) {
  const [revision, setRevision] = useState(0);
  return (
    <LoadingProvider>
      <Workspace
        key={`${id || 'home'}:${revision}`}
        id={id}
        onReset={() => setRevision((n) => n + 1)}
      />
    </LoadingProvider>
  );
}
function Workspace({ id, onReset }: { id?: string; onReset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const loading = useLoading();
  const [showRecords, setShowRecords] = useState(false);
  const store = useSessionStore(id);
  const meeting = useMeeting(store);
  const session = store.session;
  useEffect(() => {
    // 初回保存後は、再読み込みでも同じ下書きを開けるURLにします。
    if (!id && store.persisted && session?.status === 'preparing')
      window.history.replaceState(null, '', `/session/?id=${session.id}`);
  }, [id, store.persisted, session?.id, session?.status]);
  function resetHome() {
    if (id) router.replace('/');
    else {
      window.history.replaceState(null, '', '/');
      onReset();
    }
  }
  async function returnHome() {
    return loading.run(async () => {
      try {
        await meeting.prepareClose();
        if (id) router.push('/');
        else {
          window.history.pushState(null, '', '/');
          onReset();
        }
      } catch {
        meeting.setError(
          t('保存できなかったため、この画面に残りました。もう一度ホームへ戻ってください。'),
        );
      }
    });
  }
  async function start() {
    return loading.run(async () => {
      await meeting.start();
      if (store.ref.current?.status === 'active')
        window.history.replaceState(null, '', `/session/?id=${store.ref.current.id}`);
    });
  }
  return (
    <AppShell
      active={
        showRecords ? 'records' : !session || session.status === 'preparing' ? 'home' : 'meeting'
      }
      beforeClose={meeting.prepareClose}
      onHome={returnHome}
    >
      <ErrorBanner message={store.error} />
      <ErrorBanner
        message={meeting.error}
        occurredAt={meeting.errorOccurredAt}
        onDismiss={() => meeting.setError('')}
      />
      {(!id && !session) || session?.status === 'preparing' ? (
        <HomeScreen store={store} meeting={meeting} onStart={start} onReset={resetHome} />
      ) : !session ? (
        <div className="loading-screen">{t('会議を開いています…')}</div>
      ) : showRecords ? (
        <RecordsScreen
          session={session}
          meeting={meeting}
          onHome={returnHome}
          onBack={() => setShowRecords(false)}
        />
      ) : (
        <MeetingScreen store={store} meeting={meeting} onRecords={() => setShowRecords(true)} />
      )}
    </AppShell>
  );
}
