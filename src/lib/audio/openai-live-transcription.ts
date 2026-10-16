import { readProfile } from '@/components/settings/profile/profile';
import { api } from '@/lib/api';
import { encodeBase64 } from '@/lib/base64';
import { LiveUsage } from './live-usage';

type Callbacks = {
  onText: (text: string, startedAt: string, end: number) => void;
  onInterim: (text: string, startedAt?: string) => void;
  onAudio: (pcm: Uint8Array, capturedAt: number) => void;
  onBoundary: () => void;
  onUpdating: (updating: boolean) => void;
  onError: (message: string) => void;
  onWarning: (message: string) => void;
  onUsageError: () => void;
  onLimit: () => void;
};
type Turn = { id?: string; start: number; end: number; timestamp: string };
type Result = { text: string; final: boolean };
type Chunk = { pcm: Uint8Array; capturedAt: number };

// Capture and Fixed keep 16 kHz PCM; only the OpenAI wire format uses 24 kHz.
export class Pcm24k {
  private index = 0;
  private next = 0;
  private previous = 0;
  convert(pcm: Uint8Array): Uint8Array {
    const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const samples: number[] = [];
    for (let i = 0; i < pcm.length; i += 2) {
      const current = input.getInt16(i, true);
      // Integer thirds preserve interpolation phase across arbitrary chunk boundaries.
      while (this.next <= this.index * 3) {
        const fraction = this.index === 0 ? 1 : (this.next - (this.index - 1) * 3) / 3;
        samples.push(Math.round(this.previous + (current - this.previous) * fraction));
        this.next += 2;
      }
      this.previous = current;
      this.index++;
    }
    const output = new Uint8Array(samples.length * 2);
    const view = new DataView(output.buffer);
    samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
    return output;
  }
}

export class OpenAILiveTranscription {
  private resampler = new Pcm24k();
  private socket?: WebSocket;
  private usage?: LiveUsage;
  private abort = new AbortController();
  private stopped = false;
  private finishing = false;
  private updating = false;
  private ready = false;
  private deadline = 0;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private rotationTimer?: ReturnType<typeof setTimeout>;
  private chunks: Chunk[] = [];
  private buffered = 0;
  private bytes = 0;
  private committed = 0;
  private silence = 0;
  private speaking = false;
  private epoch?: number;
  private turns: Turn[] = [];
  private results = new Map<string, Result>();
  private rotation?: Promise<void>;
  private done = new Set<string>();
  private drain?: () => void;
  private saved: Promise<unknown> = Promise.resolve();

  constructor(
    private sessionId: string,
    private silenceMs: number,
    private callbacks: Callbacks,
  ) {}

  async start(minutes: 10 | 30 | 60 | 90) {
    this.deadline = Date.now() + minutes * 60_000;
    this.limitTimer = setTimeout(() => this.callbacks.onLimit(), minutes * 60_000);
    try {
      await this.connect();
    } catch (error) {
      if (!this.stopped) {
        await this.stop('failed');
        throw error;
      }
    }
  }

  private async connect() {
    const timeout = setTimeout(() => this.abort.abort(), 15_000);
    try {
      const token = await api<{ token: string; config: object; usageId: string }>(
        '/api/live-token',
        {
          method: 'POST',
          signal: this.abort.signal,
          body: JSON.stringify({
            sessionId: this.sessionId,
            profile: readProfile(),
            provider: 'openai',
          }),
        },
      );
      this.usage = new LiveUsage(token.usageId, this.sessionId, this.callbacks.onUsageError);
      if (this.stopped) {
        await this.usage.stop('cancelled');
        return;
      }
      const socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
        'realtime',
        `openai-insecure-api-key.${token.token}`,
      ]);
      this.socket = socket;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => reject(new Error('OpenAI / LiveSTTの接続がタイムアウトしました。'));
        this.abort.signal.addEventListener('abort', cancel, { once: true });
        const settle = () => {
          this.abort.signal.removeEventListener('abort', cancel);
          this.ready = true;
          resolve();
        };
        socket.onopen = () => {
          if (this.stopped) {
            socket.close();
            return;
          }
          socket.send(JSON.stringify({ type: 'session.update', session: token.config }));
        };
        socket.onmessage = (message) => {
          if (this.stopped || socket !== this.socket) return;
          try {
            const event = JSON.parse(message.data);
            this.usage?.message(event);
            if (event.type === 'session.updated') settle();
            else if (
              event.type === 'error' ||
              event.type === 'conversation.item.input_audio_transcription.failed'
            ) {
              throw new Error(
                'OpenAI / LiveSTTの認識に失敗しました。設定と接続を確認して再開してください。',
              );
            } else this.receive(event);
          } catch (error) {
            reject(error);
            this.fail();
          }
        };
        socket.onerror = socket.onclose = () => {
          this.abort.signal.removeEventListener('abort', cancel);
          if (this.stopped || socket !== this.socket) return;
          reject(new Error('OpenAI / LiveSTTに接続できませんでした。'));
          this.fail();
        };
      });
      this.rotationTimer = setTimeout(() => {
        this.rotation = this.rotate();
      }, 3 * 60_000);
    } finally {
      clearTimeout(timeout);
    }
  }

  private fail() {
    if (this.stopped) return;
    this.flush(true);
    void this.stop('failed');
    this.callbacks.onError('OpenAI / LiveSTTの接続が切れました。接続を確認して再開してください。');
  }

  push(pcm: Uint8Array) {
    if (this.stopped || this.finishing) return;
    if (Date.now() >= this.deadline) {
      this.callbacks.onLimit();
      return;
    }
    const chunk = { pcm, capturedAt: Date.now() };
    if (this.updating) {
      this.buffered += pcm.length;
      if (this.buffered > 20 * 32000) {
        this.fail();
        return;
      }
      this.chunks.push(chunk);
    } else this.send(chunk);
  }

  private send({ pcm, capturedAt }: Chunk) {
    if (!this.ready || !this.socket || this.stopped) return;
    if (pcm.length % 2 || this.socket.bufferedAmount > 2_000_000) {
      this.fail();
      return;
    }
    try {
      this.epoch ??= capturedAt - pcm.length / 32;
      this.callbacks.onAudio(pcm, capturedAt);
      // Inspect 10 ms frames so the silence setting does not depend on capture chunk size.
      for (let offset = 0; offset < pcm.length; offset += 320) {
        const frame = pcm.subarray(offset, offset + 320);
        this.socket.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encodeBase64(this.resampler.convert(frame)),
          }),
        );
        this.usage?.sent(frame.length);
        this.bytes += frame.length;
        const samples = new DataView(frame.buffer, frame.byteOffset, frame.length);
        let energy = 0;
        for (let i = 0; i < frame.length; i += 2)
          energy += (samples.getInt16(i, true) / 32768) ** 2;
        // shortcut: energy VAD; calibrate or replace if real microphones show false boundaries.
        if (Math.sqrt(energy / (frame.length / 2)) >= 0.01) {
          this.speaking = true;
          this.silence = 0;
        } else this.silence += frame.length / 32;
        if (
          (this.speaking && this.silence >= this.silenceMs) ||
          this.bytes - this.committed >= 15 * 32000
        )
          this.commit();
      }
    } catch {
      this.fail();
    }
  }

  private commit(force = false) {
    const remaining = this.bytes - this.committed;
    if (!this.ready || !remaining || (!force && remaining < 3200)) return;
    // Leave one frame of margin for the streaming resampler delay.
    if (remaining <= 3200) {
      const padding = 3520 - remaining;
      this.socket!.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: encodeBase64(new Uint8Array(Math.ceil((padding * 1.5) / 2) * 2)),
        }),
      );
      this.usage?.sent(padding);
    }
    this.turns.push({
      start: this.committed,
      end: this.bytes,
      timestamp: new Date((this.epoch ?? Date.now()) + this.committed / 32).toISOString(),
    });
    this.socket!.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.committed = this.bytes;
    this.speaking = false;
    this.silence = 0;
  }

  private receive(event: { type: string; item_id?: string; delta?: string; transcript?: string }) {
    if (!event.item_id || this.done.has(event.item_id)) return;
    if (event.type === 'input_audio_buffer.committed') {
      const turn = this.turns.find((item) => !item.id);
      if (turn) turn.id = event.item_id;
    } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
      const result = this.results.get(event.item_id) ?? { text: '', final: false };
      if (!result.final) result.text += event.delta ?? '';
      this.results.set(event.item_id, result);
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.results.set(event.item_id, { text: event.transcript ?? '', final: true });
    }
    if (this.turns.length > 100 || this.results.size > 100) {
      this.fail();
      return;
    }
    this.flush(false);
  }

  private flush(partial: boolean) {
    while (this.turns.length) {
      const turn = this.turns[0];
      const result = turn.id ? this.results.get(turn.id) : undefined;
      if (!partial && !result?.final) break;
      this.turns.shift();
      if (turn.id) {
        this.results.delete(turn.id);
        this.done.add(turn.id);
      }
      this.callbacks.onText(result?.text.trim() ?? '', turn.timestamp, turn.end / 32000);
    }
    const text = [...this.results.values()].map((result) => result.text).join(' ');
    const start = this.turns[0]?.start ?? this.committed;
    this.callbacks.onInterim(text, new Date((this.epoch ?? Date.now()) + start / 32).toISOString());
    if (!this.turns.length) this.drain?.();
  }

  private async finishTurns() {
    this.commit(true);
    if (!this.turns.length) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      this.drain = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.drain = undefined;
    if (this.turns.length) {
      this.flush(true);
      this.callbacks.onWarning(
        'OpenAI / LiveSTTの確定が間に合わなかったため、途中の認識結果を残しました。',
      );
    }
  }

  async finish() {
    if (this.stopped) return;
    this.finishing = true;
    clearTimeout(this.rotationTimer);
    try {
      await this.rotation;
      await this.finishTurns();
    } catch {
      this.fail();
    }
  }

  private async rotate() {
    if (this.stopped || this.finishing || this.updating) return;
    this.updating = true;
    this.callbacks.onUpdating(true);
    try {
      await this.finishTurns();
      if (this.stopped) return;
      const old = this.socket;
      this.socket = undefined;
      old?.close();
      this.saved = this.usage?.stop() ?? Promise.resolve();
      this.ready = false;
      this.callbacks.onBoundary();
      this.bytes = this.committed = this.silence = 0;
      this.speaking = false;
      this.epoch = undefined;
      this.results.clear();
      this.done.clear();
      this.resampler = new Pcm24k();
      await this.connect();
      if (this.stopped) return;
      this.updating = false;
      const chunks = this.chunks;
      this.chunks = [];
      this.buffered = 0;
      for (const chunk of chunks) this.send(chunk);
      this.callbacks.onUpdating(false);
    } catch {
      this.fail();
    }
  }

  stop(status: 'completed' | 'failed' | 'cancelled' = 'completed') {
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.rotationTimer);
    clearTimeout(this.limitTimer);
    this.socket?.close();
    this.drain?.();
    this.chunks = [];
    return Promise.allSettled([this.saved, this.usage?.stop(status)]).then(() => undefined);
  }
}
