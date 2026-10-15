'use client';
import { useEffect, useRef, useState } from 'react';
import { desktopInvoke, isDesktop } from '@/lib/desktop';

export function useAppClose(beforeClose?: () => Promise<void>) {
  const latest = useRef(beforeClose);
  const [error, setError] = useState('');
  useEffect(() => {
    latest.current = beforeClose;
  }, [beforeClose]);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          if (closing || disposed) return;
          closing = true;
          try {
            await latest.current?.();
            await desktopInvoke('quit_app');
          } catch {
            closing = false;
            setError(
              '保存が完了しなかったため、アプリを閉じませんでした。保存先を確認し、もう一度閉じてください。',
            );
          }
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() =>
        setError(
          '終了時の保存処理を準備できませんでした。会議を終了してからアプリを閉じてください。',
        ),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return error;
}
