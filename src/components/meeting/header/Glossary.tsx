'use client';
import { useRef } from 'react';
import { BookOpenText, X } from 'lucide-react';
import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import { useI18n } from '@/components/settings/LanguageProvider';
import { glossaryEntries } from '@/lib/session/glossary';
import type { Session } from '@/lib/session/schema';
import styles from './glossary.module.css';

export default function Glossary({ session }: { session: Session }) {
  const { t } = useI18n();
  const dismiss = useDialogDismiss();
  const dialog = useRef<HTMLDialogElement>(null);
  const entries = glossaryEntries(session);
  const sources = {
    document: t('ドキュメント'),
    analyze: t('会話分析'),
  };
  return (
    <>
      <button
        type="button"
        className="meeting-docs-button"
        aria-label={t('用語集')}
        title={t('用語集')}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <BookOpenText size={16} aria-hidden="true" />
        {t('{count}語', { count: entries.length })}
      </button>
      <dialog {...dismiss} ref={dialog} className="settings-dialog" aria-label={t('用語集')}>
        <div className="section-heading">
          <h2>
            {t('用語集')} ({entries.length})
          </h2>
          <button
            className="icon-button"
            aria-label={t('閉じる')}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {entries.length ? (
          <table className={styles.terms}>
            <thead>
              <tr>
                <th>{t('用語')}</th>
                <th>{t('出典')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ term, source }) => (
                <tr key={term.toLowerCase()}>
                  <td>{term}</td>
                  <td>{sources[source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="field-help">{t('用語はまだありません。')}</p>
        )}
      </dialog>
    </>
  );
}
