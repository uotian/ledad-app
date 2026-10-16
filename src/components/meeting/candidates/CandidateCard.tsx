import { useI18n } from '@/components/settings/LanguageProvider';
import { Check, LoaderCircle, Pause, Pencil, Play, Volume2 } from 'lucide-react';
import { useState } from 'react';
import type { SpeakingStatus } from '@/lib/audio/speaker';
import type { Candidate, Language, Utterance } from '@/lib/session/schema';
export default function CandidateCard({
  candidate,
  utterance,
  index,
  language,
  playback,
  disabled,
  onSpeech,
  onEdit,
}: {
  candidate: Candidate;
  utterance?: Utterance;
  index: number;
  language: Language;
  playback: SpeakingStatus;
  disabled: boolean;
  onSpeech: () => void;
  onEdit: (text: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const hasHistory = !!utterance || candidate.status === 'spoken';
  const canEdit = !hasHistory && playback === 'idle' && !disabled;
  const status =
    playback === 'loading'
      ? '音声生成中'
      : playback === 'speaking'
        ? '読み上げ中'
        : utterance?.status === 'failed'
          ? '読み上げ失敗'
          : playback === 'paused' ||
              utterance?.status === 'interrupted' ||
              utterance?.status === 'playing'
            ? '途中停止'
            : hasHistory
              ? '発話済み'
              : null;
  const editLabel = editing ? t('完了') : t('発話する文章を編集する');
  const speechLabel = t(
    playback === 'paused'
      ? '候補{number}の読み上げを再開'
      : playback === 'idle'
        ? hasHistory
          ? '候補{number}をもう一度読み上げる'
          : '候補{number}を読み上げる'
        : '候補{number}の読み上げを停止',
    { number: index + 1 },
  );
  const speechButton = (
    <button
      className="icon-button candidate-speak"
      onClick={onSpeech}
      disabled={disabled || (playback === 'idle' && !candidate.spokenText.trim())}
      aria-label={speechLabel}
      title={speechLabel}
    >
      {playback === 'loading' ? (
        <LoaderCircle size={18} className="spin" />
      ) : playback === 'speaking' ? (
        <Pause size={18} />
      ) : playback === 'paused' ? (
        <Play size={18} />
      ) : (
        <Volume2 size={18} />
      )}
    </button>
  );
  const spokenContent = (
    <div className="candidate-speech">
      {editing && canEdit ? (
        <textarea
          autoFocus
          aria-label={t('発話する文章')}
          rows={2}
          value={candidate.spokenText}
          disabled={!canEdit}
          onChange={(e) => onEdit(e.target.value)}
        />
      ) : (
        <p className="candidate-text" lang={language}>
          {candidate.spokenText}
        </p>
      )}
      {!hasHistory && (
        <button
          className="icon-button candidate-edit-toggle"
          onClick={() => setEditing(!editing)}
          disabled={!canEdit}
          aria-label={editLabel}
          title={editLabel}
          aria-pressed={editing}
        >
          {editing ? <Check size={16} /> : <Pencil size={16} />}
        </button>
      )}
    </div>
  );
  return (
    <article className="candidate-card">
      <div className="candidate-header">
        <h3 className="candidate-heading">
          <span className="candidate-number">{String(index + 1).padStart(2, '0')}</span>
          <strong>{candidate.title}</strong>
        </h3>
        {speechButton}
      </div>
      {status && (
        <p className="candidate-status" role="status">
          {t(status)}
        </p>
      )}
      {spokenContent}
      {(candidate.translationLanguage ?? 'ja') !== language && candidate.text && (
        <p className="candidate-reference" lang={candidate.translationLanguage ?? 'ja'}>
          {candidate.text}
        </p>
      )}
      {candidate.caution && <p className="candidate-caution">{candidate.caution}</p>}
    </article>
  );
}
