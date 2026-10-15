'use client';
import { useDialogDismiss } from '@/hooks/useDialogDismiss';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useI18n } from '@/components/settings/LanguageProvider';
import styles from './loading.module.css';

type Loading = {
  run: (action: () => Promise<void>) => Promise<void>;
};
const Context = createContext<Loading | null>(null);

export function useLoading() {
  const loading = useContext(Context);
  if (!loading) throw new Error('LoadingProvider is required');
  return loading;
}

export function LoadingProvider({ children }: { children: ReactNode }) {
  const dismiss = useDialogDismiss();
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<Promise<void> | null>(null);
  function run(action: () => Promise<void>): Promise<void> {
    if (pending.current) return pending.current;
    dialog.current?.showModal();
    // 同じイベント内の連続操作も、処理を始める前にロックします。
    const task = Promise.resolve()
      .then(action)
      .finally(() => {
        pending.current = null;
        dialog.current?.close();
      });
    pending.current = task;
    return task;
  }
  return (
    <Context value={{ run }}>
      {children}
      <dialog
        {...dismiss}
        ref={dialog}
        className={styles.loading}
        aria-label={t('処理中')}
        onCancel={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Tab') event.preventDefault();
        }}
      >
        <div role="status" aria-live="polite" tabIndex={-1}>
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          {t('処理中')}
        </div>
      </dialog>
    </Context>
  );
}
