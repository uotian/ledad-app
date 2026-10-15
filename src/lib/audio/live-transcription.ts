import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { api } from '@/lib/api';
import { LiveUsage } from './live-usage';

const renewalMs = 9 * 60_000;
const maxSpeechBytes = 15 * 32_000;
const connectTimeoutMs = 15_000;
const drainMs = 1500;
const maxBufferedBytes = 20 * 32_000;
type Chunk = { pcm: Uint8Array; data: string; capturedAt: number };
type Connection = { live?: Session; usage: LiveUsage; retired: boolean };
type Callbacks = {
  onMessage: (message: LiveServerMessage) => void;
  onAudio: (pcm: Uint8Array, capturedAt: number) => void;
  onBoundary: () => void;
  onUpdating: (updating: boolean) => void;
  onError: (message: string) => void;
  onUsageError: () => void;
  onLimit: () => void;
};

// 文字起こし専用の接続を更新する。音声取得と会議IDは接続より長く保持する。
export class LiveTranscription {
  private stopped = false;
  private updating = false;
  private current?: Connection;
  private pending?: Connection;
  private rotationTimer?: ReturnType<typeof setTimeout>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private abort = new AbortController();
  private chunks: Chunk[] = [];
  private bufferedBytes = 0;
  private sentBytes = 0;
  private boundaryBytes = 0;
  private deadline = 0;
  private saves = new Set<Promise<unknown>>();

  constructor(
    private sessionId: string,
    private callbacks: Callbacks,
  ) {}

  async start(minutes: 10 | 30 | 60 | 90) {
    this.deadline = Date.now() + minutes * 60_000;
    this.limitTimer = setTimeout(() => this.expire(), minutes * 60_000);
    try {
      await this.connect();
    } catch (error) {
      if (!this.stopped) {
        void this.stop('failed');
        throw error;
      }
    }
  }

  private available() {
    if (this.stopped) return false;
    // タイマーが遅延した場合も、復帰後の音声送信や再接続より先に期限を確認する。
    if (Date.now() >= this.deadline) {
      this.expire();
      return false;
    }
    return true;
  }

  private expire() {
    if (this.stopped) return;
    void this.stop();
    this.callbacks.onLimit();
  }

  private fail() {
    if (this.stopped) return;
    void this.stop('failed');
    this.callbacks.onError(
      'Gemini / LiveSTTの接続：聞き取りの接続を更新できませんでした。接続を確認して再開してください。',
    );
  }

  // SDKの接続待ちにも期限と取消を設ける。遅れて開いたソケットはconnect内で閉じる。
  private async bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new DOMException('取消', 'AbortError'));
      timer = setTimeout(
        () =>
          reject(
            new Error('Gemini / LiveSTTの接続：聞き取りの接続がタイムアウトしました。'),
          ),
        milliseconds,
      );
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      if (this.abort.signal.aborted) cancel();
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', cancel);
    }
  }

  private retire(connection: Connection | undefined, status: 'completed' | 'failed' | 'cancelled') {
    if (!connection || connection.retired) return;
    connection.retired = true;
    connection.live?.close();
    const saved = connection.usage.stop(status);
    this.saves.add(saved);
    void saved.finally(() => this.saves.delete(saved));
  }

  private async connect() {
    const tokenAbort = new AbortController();
    const abortToken = () => tokenAbort.abort();
    this.abort.signal.addEventListener('abort', abortToken, { once: true });
    try {
      const token = await this.bounded(
        api<{
          token: string;
          model: string;
          config: LiveConnectConfig;
          usageId: string;
        }>('/api/live-token', {
          method: 'POST',
          body: JSON.stringify({ sessionId: this.sessionId }),
          signal: tokenAbort.signal,
        }),
        connectTimeoutMs,
      );
      const connection: Connection = {
        usage: new LiveUsage(token.usageId, this.sessionId, this.callbacks.onUsageError),
        retired: false,
      };
      this.pending = connection;
      if (!this.available()) {
        this.retire(connection, 'cancelled');
        return;
      }
      const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: 'v1beta' } });
      const opening = ai.live
        .connect({
          model: token.model,
          config: token.config,
          callbacks: {
            onmessage: (message) => {
              if (connection.retired || !this.available()) return;
              connection.usage.message(message);
              if (message.usageMetadata) connection.usage.received(message.usageMetadata);
              const activity = message.voiceActivity as
                { type?: string; voiceActivityType?: string; audioOffset?: string } | undefined;
              // audioStreamEnd後も同じ接続のaudioOffsetは通算なので補正しない。
              if ((activity?.type ?? activity?.voiceActivityType) === 'ACTIVITY_END') {
                const offset = /^(\d+(?:\.\d+)?)s$/.exec(activity?.audioOffset ?? '');
                if (offset)
                  this.boundaryBytes = Math.max(
                    this.boundaryBytes,
                    Math.min(this.sentBytes, Number(offset[1]) * 32_000),
                  );
              }
              this.callbacks.onMessage(message);
              if (message.goAway) void this.rotate();
            },
            onerror: () => {
              if (!connection.retired && !(this.updating && connection === this.current))
                this.fail();
            },
            onclose: () => {
              if (!connection.retired && !(this.updating && connection === this.current))
                this.fail();
            },
          },
        })
        .then((live) => {
          connection.live = live;
          if (connection.retired || this.stopped) live.close();
          return live;
        });
      await this.bounded(opening, connectTimeoutMs);
      if (!this.available() || connection.retired) return;
      this.current = connection;
      this.pending = undefined;
      this.sentBytes = this.boundaryBytes = 0;
      this.rotationTimer = setTimeout(() => void this.rotate(), renewalMs);
    } finally {
      tokenAbort.abort();
      this.abort.signal.removeEventListener('abort', abortToken);
    }
  }

  private async rotate() {
    if (!this.available() || this.updating) return;
    this.updating = true;
    clearTimeout(this.rotationTimer);
    this.callbacks.onUpdating(true);
    try {
      // 以降の音声は一時保持し、旧接続には送らない。末尾の確定結果を短時間待つ。
      this.current?.live?.sendRealtimeInput({ audioStreamEnd: true });
      await this.bounded(
        new Promise<void>((resolve) => setTimeout(resolve, drainMs)),
        drainMs + 100,
      );
      if (!this.available()) return;
      this.retire(this.current, 'completed');
      this.current = undefined;
      this.callbacks.onBoundary();
      await this.connect();
      if (!this.available()) return;
      this.updating = false;
      const chunks = this.chunks;
      this.chunks = [];
      this.bufferedBytes = 0;
      for (const chunk of chunks) this.send(chunk);
      if (this.available()) this.callbacks.onUpdating(false);
    } catch {
      this.fail();
    }
  }

  push(pcm: Uint8Array, data: string) {
    if (!this.available()) return;
    const chunk = { pcm, data, capturedAt: Date.now() };
    if (this.updating) {
      this.bufferedBytes += pcm.length;
      if (this.bufferedBytes > maxBufferedBytes) {
        this.fail();
        return;
      }
      this.chunks.push(chunk);
    } else this.send(chunk);
  }

  private send(chunk: Chunk) {
    if (!this.available() || !this.current?.live) return;
    try {
      this.current.live.sendRealtimeInput({
        audio: { data: chunk.data, mimeType: 'audio/pcm;rate=16000' },
      });
      this.current.usage.sent(chunk.pcm.length);
      this.callbacks.onAudio(chunk.pcm, chunk.capturedAt);
      this.sentBytes += chunk.pcm.length;
      // 画面のタイマー遅延や通知の欠落に左右されず、送信した音声の長さで区切る。
      if (this.sentBytes - this.boundaryBytes >= maxSpeechBytes) {
        this.current.live.sendRealtimeInput({ audioStreamEnd: true });
        this.boundaryBytes = this.sentBytes;
      }
    } catch {
      this.fail();
    }
  }

  stop(status: 'completed' | 'failed' | 'cancelled' = 'completed') {
    this.stopped = true;
    clearTimeout(this.rotationTimer);
    clearTimeout(this.limitTimer);
    this.abort.abort();
    this.retire(this.current, status);
    this.retire(this.pending, status);
    this.chunks = [];
    this.bufferedBytes = 0;
    return Promise.allSettled([...this.saves]).then(() => undefined);
  }
}
