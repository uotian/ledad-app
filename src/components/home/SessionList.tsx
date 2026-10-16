import { useI18n } from '@/components/settings/LanguageProvider';
import Link from 'next/link';
import { ArrowRight, SquareCheck, Trash2 } from 'lucide-react';
import type { SessionSummary } from '@/lib/session/schema';
import Button from '@/components/ui/Button';
export default function SessionList({
  sessions,
  onDelete,
  onDeleteAll,
  onOpen,
  deleting,
  disabled,
}: {
  sessions: SessionSummary[];
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onOpen: (id: string) => void;
  deleting: boolean;
  disabled: boolean;
}) {
  const { t, locale } = useI18n();
  const visibleSessions = sessions.filter((session) => session.status !== 'preparing');
  return (
    <section className="recent-sessions">
      <div className="section-heading">
        <h2>{t('最近の会議')}</h2>
        {visibleSessions.length > 0 && (
          <span className="session-count">
            {visibleSessions.length}
            {t('件')}
          </span>
        )}
        {sessions.length > 0 && (
          <Button small variant="ghost" onClick={onDeleteAll} disabled={disabled}>
            <Trash2 size={14} aria-hidden="true" />
            {deleting ? t('削除中…') : t('すべて削除')}
          </Button>
        )}
      </div>
      {visibleSessions.length === 0 ? (
        <p className="session-empty">no data</p>
      ) : (
        <div className="session-list">
          {visibleSessions.map((s) => (
            <div className="session-row" key={s.id}>
              <Link
                href={`/session/?id=${s.id}`}
                className="session-link"
                aria-disabled={disabled}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (!disabled) onOpen(s.id);
                }}
              >
                <strong>{s.title}</strong>
                {s.hasMinutes && (
                  <span
                    className="session-check"
                    role="img"
                    aria-label={t('要約済み')}
                    title={t('要約済み')}
                  >
                    <SquareCheck size={16} aria-hidden="true" />
                  </span>
                )}
              </Link>
              {s.meetingStartedAt && s.meetingLastAt && (
                <div className="session-time">
                  <span>
                    {new Date(s.meetingStartedAt).toLocaleDateString(locale, {
                      month: 'long',
                      day: '2-digit',
                    })}
                  </span>{' '}
                  <span>
                    {formatTime(s.meetingStartedAt)} (
                    {t('{count}分', {
                      count: Math.ceil(
                        (Date.parse(s.meetingLastAt) - Date.parse(s.meetingStartedAt)) / 60_000,
                      ),
                    })}
                    )
                  </span>
                </div>
              )}
              <button
                className="icon-button"
                aria-label={t('{v0}を削除', { v0: s.title })}
                onClick={() => onDelete(s.id)}
                disabled={disabled}
              >
                <Trash2 size={16} />
              </button>
              <Link
                className="icon-button"
                href={`/session/?id=${s.id}`}
                aria-label={t('{v0}を開く', { v0: s.title })}
                aria-disabled={disabled}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (!disabled) onOpen(s.id);
                }}
              >
                <ArrowRight size={18} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
