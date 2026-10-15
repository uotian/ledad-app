import { useI18n } from '@/components/settings/LanguageProvider';
import { Trash2 } from 'lucide-react';
import type { Document } from '@/lib/session/schema';
export default function DocumentItem({
  document: d,
  onRemove,
  disabled,
}: {
  document: Document;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="document-item" role="group" aria-label={d.name}>
      <div className="document-file">
        <span className="document-name" title={d.name}>
          {d.name}
        </span>
        <span className="document-size">{Math.max(1, Math.round(d.size / 1024))} KB</span>
        <button
          className="icon-button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('{v0}を取り除く', { v0: d.name })}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
