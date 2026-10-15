import { useI18n } from '@/components/settings/LanguageProvider';
import { Play, Square, Save, LoaderCircle } from 'lucide-react';
import type { Session } from '@/lib/session/schema';
import type { Meeting } from '@/hooks/useMeeting';
import Button from '@/components/ui/Button';
import InputLevelMeter from './InputLevelMeter';
import FixProgress from './FixProgress';
export default function SessionControls({
  session,
  meeting,
  onRecords,
  documentsUpdating,
}: {
  session: Session;
  meeting: Meeting;
  onRecords: () => void;
  documentsUpdating: boolean;
}) {
  const { t } = useI18n();
  const ended = session.status === 'ended' || !!session.minutes;
  const listening = ['listening', 'connecting', 'updating'].includes(meeting.listening);
  const busy = meeting.ending || meeting.starting || meeting.stoppingListening;
  const listeningLabel = meeting.stoppingListening
    ? t('停止中...')
    : meeting.listening === 'connecting'
      ? t('接続を取消')
      : listening
        ? t('停止')
        : t('再開');
  async function finishMeeting() {
    if (await meeting.end()) {
      onRecords();
      void meeting.createMinutes();
    }
  }
  const preparing =
    !meeting.stoppingListening &&
    (meeting.listening === 'connecting' || (meeting.starting && !listening));
  const state = preparing
    ? 'preparing'
    : !ended && listening && !meeting.stoppingListening
      ? 'listening'
      : 'stopped';
  const stateText =
    state === 'preparing'
      ? t('Live聞き取り準備中…')
      : state === 'listening'
        ? t('Live聞き取り中')
        : t('Live聞き取り停止中');
  return (
    <footer className="session-controls">
      <div className="audio-state" data-state={state}>
        <div className="audio-state-icon">
          <InputLevelMeter
            level={meeting.level}
            active={
              !ended &&
              !meeting.stoppingListening &&
              ['listening', 'updating'].includes(meeting.listening)
            }
          />
        </div>
        <div className="audio-state-label">
          <div className="audio-state-heading">
            <strong aria-live="polite">{stateText}</strong>
            <FixProgress progress={meeting.fixProgress} />
            {(meeting.analyze.pending || meeting.analyze.remainingSeconds !== null) && (
              <span className="conversation-analysis-progress" aria-live="off">
                {meeting.analyze.pending
                  ? t('会話分析中')
                  : t('会話分析待ち（あと約{seconds}秒）', {
                      seconds: meeting.analyze.remainingSeconds ?? 0,
                    })}
              </span>
            )}
          </div>
        </div>
      </div>
      {ended ? (
        <div className="listening-controls">
          <Button small onClick={onRecords} disabled={busy}>
            {t('会議の記録を見る')}
          </Button>
        </div>
      ) : (
        <div className="listening-controls">
          {!listening && (
            <Button
              small
              className="session-action session-action-finish"
              disabled={busy || meeting.processing || documentsUpdating}
              onClick={finishMeeting}
              title={t('会議を終了')}
            >
              <Save size={15} />
              {t('終了')}
            </Button>
          )}
          <Button
            small
            className={`session-action session-action-${listening ? 'stop' : 'resume'}`}
            onClick={meeting.toggleListening}
            disabled={busy}
            aria-label={listeningLabel}
            title={listening ? t('聞き取りを停止') : t('聞き取りを再開')}
          >
            {meeting.stoppingListening ? (
              <LoaderCircle size={15} className="spin" />
            ) : listening ? (
              <Square size={14} />
            ) : (
              <Play size={15} />
            )}
            {listeningLabel}
          </Button>
        </div>
      )}
    </footer>
  );
}
