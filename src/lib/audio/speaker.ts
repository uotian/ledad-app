import type { Settings, Utterance } from '@/lib/session/schema';
import { splitSpeech } from '@/lib/audio/speech';
import { serviceFetch } from '@/lib/desktop';
import { readVoice } from '@/components/settings/voice';
export type SpeakingStatus = 'idle' | 'loading' | 'speaking' | 'paused';
type Job = {
  record: Utterance;
  parts: string[];
  index: number;
  audio: HTMLAudioElement | null;
  url: string | null;
  elapsed: number;
  settings: Settings;
};
type Callbacks = {
  onStatus: (status: SpeakingStatus) => void;
  onRecord: (record: Utterance) => void;
  onError: (message: string) => void;
};
export class MeetingSpeaker {
  private current: Job | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private state: SpeakingStatus = 'idle';
  constructor(
    private callbacks: Callbacks,
    private sessionId: string | null = null,
  ) {}
  get status() {
    return this.state;
  }
  get canResume() {
    return this.state === 'paused';
  }
  get candidateId() {
    return this.current?.record.candidateId ?? null;
  }
  private statusChange(state: SpeakingStatus) {
    this.state = state;
    this.callbacks.onStatus(state);
  }
  start(
    text: string,
    settings: Settings,
    candidateId: string | null = null,
    targetId: string | null = null,
  ) {
    this.pause();
    if (this.current) this.releaseAudio(this.current);
    const expanded = splitSpeech(text);
    if (!expanded.length) {
      this.callbacks.onError('発話する文章がありません。候補を確認してください。');
      return;
    }
    const job: Job = {
      record: {
        id: crypto.randomUUID(),
        kind: 'speech',
        candidateId,
        targetId,
        page: null,
        plannedText: expanded.join('\n'),
        completedText: '',
        status: 'playing',
        startedAt: new Date().toISOString(),
        endedAt: null,
        elapsedSeconds: 0,
      },
      parts: expanded,
      index: 0,
      audio: null,
      url: null,
      elapsed: 0,
      settings: { ...settings, voice: readVoice() ?? settings.voice },
    };
    this.current = job;
    this.callbacks.onRecord({ ...job.record });
    void this.play(job);
  }
  private async play(job: Job) {
    const generation = ++this.generation;
    this.controller = new AbortController();
    try {
      const part = job.parts[job.index];
      if (!part) return;
      if (!job.audio) {
        this.statusChange('loading');
        const response = await serviceFetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.sessionId,
            text: part,
            language: job.settings.language,
            voice: job.settings.voice,
          }),
          signal: this.controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || '音声を作れませんでした。再開で再試行できます。');
        }
        const blob = await response.blob();
        if (generation !== this.generation) return;
        job.url = URL.createObjectURL(blob);
        job.audio = new Audio(job.url);
        // 出力先はOSのサウンド設定に従います。旧保存値のoutputIdでは固定しません。
      }
      if (generation !== this.generation) return;
      const audio = job.audio;
      audio.onended = () => {
        if (generation !== this.generation) return;
        job.elapsed += Number.isFinite(audio.duration) ? audio.duration : audio.currentTime;
        job.record.completedText += (job.record.completedText ? '\n' : '') + part;
        job.record.elapsedSeconds = job.elapsed;
        this.releaseAudio(job);
        job.index++;
        this.callbacks.onRecord({ ...job.record });
        if (job.index < job.parts.length) void this.play(job);
        else {
          job.record.status = 'completed';
          job.record.endedAt = new Date().toISOString();
          this.callbacks.onRecord({ ...job.record });
          this.current = null;
          this.statusChange('idle');
        }
      };
      audio.onerror = () => {
        if (generation === this.generation)
          this.fail(job, '音声を再生できませんでした。出力先を確認し、再開してください。');
      };
      await audio.play();
      if (generation !== this.generation) {
        audio.pause();
        return;
      }
      job.record.status = 'playing';
      job.record.endedAt = null;
      this.callbacks.onRecord({ ...job.record });
      this.statusChange('speaking');
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(job, error instanceof Error ? error.message : '音声を再生できませんでした。');
    }
  }
  private fail(job: Job, message: string) {
    this.pause();
    this.releaseAudio(job);
    job.record.status = 'failed';
    this.callbacks.onRecord({ ...job.record });
    this.callbacks.onError(message);
  }
  pause() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    const job = this.current;
    if (!job) return;
    job.audio?.pause();
    if (job.record.status !== 'failed') job.record.status = 'interrupted';
    job.record.endedAt = new Date().toISOString();
    job.record.elapsedSeconds = job.elapsed + (job.audio?.currentTime || 0);
    this.callbacks.onRecord({ ...job.record });
    this.statusChange('paused');
  }
  resume() {
    if (this.state === 'paused' && this.current) void this.play(this.current);
  }
  private releaseAudio(job: Job) {
    if (job.audio) {
      job.audio.onended = null;
      job.audio.onerror = null;
      job.audio.pause();
      job.audio.removeAttribute('src');
      job.audio.load();
    }
    if (job.url) URL.revokeObjectURL(job.url);
    job.audio = null;
    job.url = null;
  }
  stop() {
    this.pause();
    if (this.current) this.releaseAudio(this.current);
    this.current = null;
    this.statusChange('idle');
  }
}
