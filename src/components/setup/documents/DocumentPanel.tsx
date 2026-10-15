'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLoading } from '@/components/ui/Loading';
import { Upload, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { documentSchema, type Document } from '@/lib/session/schema';
import type { SessionStore } from '@/hooks/useSessionStore';
import DocumentItem from './DocumentItem';
import ChatReplyContent from '@/components/meeting/chat/ChatReplyContent';
import Button from '@/components/ui/Button';
import { documentsPending, documentsFor } from '@/lib/session/policy';
export default function DocumentPanel({
  store,
  onError,
  onUploadingChange,
}: {
  store: SessionStore;
  onError: (message: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useI18n();
  const loading = useLoading();
  const { session, update, flush, ensureSaved, prepareDocuments } = store;
  const readOnly = session?.status === 'ended';
  const [uploading, setUploading] = useState(false);
  const [warning, setWarning] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<Element | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  async function run(action: () => Promise<void>) {
    if (pending.current || store.ref.current?.status === 'ended') return;
    pending.current = true;
    setUploading(true);
    onUploadingChange?.(true);
    const work = async () => {
      try {
        onError('');
        await action();
      } catch (e) {
        onError(e instanceof Error ? e.message : t('資料を読み取れませんでした。'));
      } finally {
        pending.current = false;
        setUploading(false);
        onUploadingChange?.(false);
        if (input.current) input.current.value = '';
      }
    };
    if (session?.status === 'active') await work();
    else await loading.run(work);
  }
  async function upload(files: File[]) {
    if (!session || !files.length) return;
    await run(async () => {
      setWarning('');
      await ensureSaved();
      for (const file of files) {
        const data = new FormData();
        data.append('file', file);
        data.append('kind', 'reference');
        const result = await api<{ document: Document; warning: string }>(
          `/api/sessions/${session.id}/documents`,
          { method: 'POST', body: data },
        );
        if (result.warning) setWarning(result.warning);
        update((s) => ({
          ...s,
          documents: [...s.documents, documentSchema.parse(result.document)],
        }));
        await flush();
      }
      if (store.ref.current?.status === 'active') await prepareDocuments();
    });
  }
  const uploadDroppedFiles = useEffectEvent((files: File[]) => void upload(files));
  useEffect(() => {
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const canUpload = () =>
      !!input.current &&
      !input.current.matches(':disabled') &&
      !Array.from(document.querySelectorAll('dialog[open]')).some(
        (dialog) => dialog !== input.current?.closest('dialog'),
      );
    function handleDrag(event: DragEvent) {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      const enabled = canUpload();
      if (event.type === 'dragenter') {
        depth++;
        if (enabled) setDropTarget(input.current?.closest('dialog[open]') ?? document.body);
        setDragging(enabled);
      } else if (event.type === 'dragleave') {
        depth = Math.max(0, depth - 1);
        if (!depth) setDragging(false);
      } else if (event.type === 'dragover') {
        event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      } else if (event.type === 'drop') {
        reset();
        // ドロップイベントを抜けるとFileListを読めなくなるため、先に確保します。
        if (enabled) uploadDroppedFiles(Array.from(event.dataTransfer.files));
      }
    }
    const events = ['dragenter', 'dragleave', 'dragover', 'drop'] as const;
    for (const event of events) window.addEventListener(event, handleDrag);
    function handlePaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (!files.length || !canUpload()) return;
      event.preventDefault();
      uploadDroppedFiles(files);
    }
    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      for (const event of events) window.removeEventListener(event, handleDrag);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);
  if (!session) return null;
  const summary = documentsFor(session);
  const terms = [...new Set(session.documentReference?.glossary ?? [])];
  return (
    <section className="document-panel">
      {dragging &&
        dropTarget &&
        createPortal(
          <div className="document-drop-overlay" role="status">
            <div>
              <Upload size={32} aria-hidden="true" />
              <strong>{t('ドロップして資料を追加')}</strong>
              <span>{t('PDF・PPT・画像・TXT・Markdown / 1ファイル20MBまで')}</span>
            </div>
          </div>,
          dropTarget,
        )}
      {!readOnly && (
        <button className="upload-area" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <LoaderCircle size={24} className="spin" /> : <Upload size={24} />}
          <strong>{uploading ? t('資料を登録しています…') : t('ファイルを選んで登録')}</strong>
          <span>{t('ドロップ・画像の貼り付けにも対応')}</span>
          <span>{t('PDF・PPT・画像・TXT・Markdown / 1ファイル20MBまで')}</span>
        </button>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md"
        multiple
        disabled={uploading || readOnly}
        aria-label={t('資料ファイル')}
        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
      />
      {warning && <p className="warning-note">{warning}</p>}
      <div className="document-list">
        {session.documents.map((d) => (
          <DocumentItem
            key={d.id}
            document={d}
            disabled={uploading || readOnly}
            onRemove={() =>
              void run(async () => {
                update((s) => ({
                  ...s,
                  documents: s.documents.filter((x) => x.id !== d.id),
                }));
                await flush();
                if (store.ref.current?.status === 'active') await prepareDocuments();
              })
            }
          />
        ))}
      </div>
      {summary && (
        <div className="document-results">
          <section className="document-reference">
            <h3 className="document-reference-title">{t('要約')}</h3>
            <div className="document-reference-content">
              <ChatReplyContent text={summary} />
            </div>
          </section>
          <section className="document-reference">
            <h3 className="document-reference-title">
              {t('用語集（{count}語）', { count: terms.length })}
            </h3>
            <div className="document-reference-content">
              {terms.length ? (
                <ul>
                  {terms.map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
              ) : (
                <p>{t('用語はありません。')}</p>
              )}
            </div>
          </section>
        </div>
      )}
      {session.documents.length > 0 && documentsPending(session) && session.status !== 'ended' && (
        <Button
          small
          disabled={uploading}
          onClick={() =>
            void run(async () => {
              await flush();
              await prepareDocuments();
            })
          }
        >
          {t('要約・用語集を作成')}
        </Button>
      )}
    </section>
  );
}
