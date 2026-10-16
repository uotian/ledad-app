import { ReviewBuffer, type AudioReview, type ReviewProgress } from './review-buffer';
import { TranscriptClock } from './transcript-clock';
import { OpenAILiveTranscription } from './openai-live-transcription';
import { LiveTranscription } from './live-transcription';
import type { LiveServerMessage } from '@google/genai';
import type { Settings } from '@/lib/session/schema';
import { isDesktop } from '@/lib/desktop';
import { NativeCapture, type AppleTranscript } from './native-capture';
import { decodeBase64, encodeBase64 } from '@/lib/base64';
import { api } from '@/lib/api';
export type ListeningStatus = 'idle' | 'connecting' | 'listening' | 'updating' | 'error';
type Callbacks = {
  onText: (text: string, startedAt?: string, completeUtterance?: boolean) => string | void;
  onReview?: (review: AudioReview, signal: AbortSignal) => Promise<void>;
  onReviewProgress?: (progress: ReviewProgress) => void;
  onInterim: (text: string, startedAt?: string) => void;
  onStatus: (status: ListeningStatus) => void;
  onError: (message: string) => void;
  onLevel: (level: number) => void;
};
export class MeetingListener {
  private review?: ReviewBuffer;
  private reviewAbort = new AbortController();
  private reviews = new Set<Promise<void>>();
  private reviewProgressKey = '';
  private interim = '';
  private clock = new TranscriptClock();
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private connection?: LiveTranscription | OpenAILiveTranscription;
  private worklet?: AudioWorkletNode;
  private native?: NativeCapture;
  private appleEpoch?: number;
  private applePending: AppleTranscript[] = [];
  private nativeNeedsFinish = false;
  private finishing?: Promise<void>;
  private appleLimitTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(private callbacks: Callbacks) {}
  async start(settings: Settings, sessionId: string) {
    // 明示的な再開でも、前の区間の録音再認識・翻訳は最後まで完了させる。
    if (
      this.nativeNeedsFinish ||
      this.finishing ||
      this.connection instanceof OpenAILiveTranscription
    )
      await this.stop();
    else void this.stop();
    const generation = this.generation;
    // 音声機器を使わない操作テスト専用。本番ビルドでは必ず取得処理へ進みます。
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_LEDAD_DISABLE_AUDIO_CAPTURE === '1'
    ) {
      // 実際の音声取得をせず、開始・停止の操作状態だけを再現します。
      this.callbacks.onStatus('listening');
      return;
    }
    if (this.reviewAbort.signal.aborted) this.reviewAbort = new AbortController();
    this.createReview(settings.fixIntervalSeconds);
    this.callbacks.onStatus('connecting');
    try {
      const { liveProvider } = await api<{ liveProvider: 'gemini' | 'apple' | 'openai' }>(
        '/api/config',
      );
      if (liveProvider === 'apple' && !isDesktop())
        throw new Error('Apple SpeechTranscriberはMacアプリで利用してください。');
      if (isDesktop()) {
        if (liveProvider !== 'apple')
          await this.connect(settings, sessionId, generation, liveProvider);
        if (generation !== this.generation) return;
        const native = new NativeCapture();
        this.native = native;
        await native.start(
          settings.input,
          (data, level) => {
            if (generation !== this.generation) return;
            this.callbacks.onLevel(level);
            try {
              const pcm = decodeBase64(data);
              if (liveProvider === 'apple') {
                const capturedAt = Date.now();
                this.appleEpoch ??= capturedAt - pcm.length / 32;
                this.review?.append(pcm, capturedAt);
                this.publishReviewProgress();
              } else this.connection?.push(pcm, data);
            } catch {
              this.fail('音声を送信できません。聞き取りを再開してください。');
            }
          },
          (message) => {
            if (generation === this.generation) this.fail(message);
          },
          liveProvider === 'apple'
            ? {
                locale: { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN', fr: 'fr-FR' }[settings.language],
                onTranscript: (result) => {
                  if (generation === this.generation) this.receiveAppleTranscript(result);
                },
              }
            : undefined,
          (message) => {
            if (generation === this.generation) this.callbacks.onError(message);
          },
        );
        if (generation === this.generation) {
          this.nativeNeedsFinish = liveProvider === 'apple' || settings.input === 'mixed';
          if (liveProvider === 'apple') {
            this.appleLimitTimer = setTimeout(() => {
              void this.stop();
              this.callbacks.onError(
                '設定した時間に達したため、聞き取りを自動停止しました。続ける場合は「再開」を押してください。',
              );
            }, settings.listeningLimitMinutes * 60_000);
          }
          this.callbacks.onStatus('listening');
        }
        return;
      }
      if (!navigator.mediaDevices)
        throw new Error(
          'このブラウザでは音声を取得できません。Chromeのlocalhostで開いてください。',
        );
      const inputs = settings.input === 'mixed' ? ['display', 'microphone'] : [settings.input];
      for (const input of inputs) {
        const stream =
          input === 'display'
            ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
            : await navigator.mediaDevices.getUserMedia({
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
                video: false,
              });
        if (generation !== this.generation) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.streams.push(stream);
        if (!stream.getAudioTracks().length)
          throw new Error(
            '共有元の音声を取得できませんでした。「タブの音声を共有」を有効にしてください。取得できない環境ではマイクまたは仮想入力を選んでください。',
          );
        stream.getTracks().forEach((track) => {
          track.onended = () => {
            if (generation === this.generation)
              this.fail('音声の共有が終了しました。「再開」から接続し直してください。');
          };
        });
      }
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      await this.connect(settings, sessionId, generation, liveProvider);
      if (generation !== this.generation) return;
      await context.audioWorklet.addModule('/audio/pcm-processor.js');
      if (generation !== this.generation) return;
      const mix = context.createGain();
      mix.channelCount = 1;
      mix.channelCountMode = 'explicit';
      // 同時発話でも飽和しないよう、合成時は双方の音量を半分にします。
      mix.gain.value = settings.input === 'mixed' ? 0.5 : 1;
      for (const stream of this.streams)
        context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(mix);
      const worklet = new AudioWorkletNode(context, 'pcm-processor');
      this.worklet = worklet;
      worklet.port.onmessage = (event) => {
        if (generation !== this.generation) return;
        const bytes = new Uint8Array(event.data);
        const pcm = new Int16Array(event.data);
        let sum = 0;
        for (const sample of pcm) sum += (sample / 32768) ** 2;
        this.callbacks.onLevel(Math.min(1, Math.sqrt(sum / pcm.length) * 5));
        try {
          this.connection?.push(bytes, encodeBase64(bytes));
        } catch {
          this.fail('音声を送信できませんでした。聞き取りを再開してください。');
        }
      };
      // 出力は無音。AudioWorkletを稼働させつつ、入力のスピーカー再生を防ぎます。
      const silent = context.createGain();
      silent.gain.value = 0;
      mix.connect(worklet).connect(silent).connect(context.destination);
      this.callbacks.onStatus('listening');
    } catch (error) {
      if (generation !== this.generation) return;
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '音声の許可がありません。ブラウザのマイク許可を確認し、聞き取りを再開してください。'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? '音声入力が見つかりません。マイクを接続して再試行してください。'
            : error instanceof Error
              ? error.message
              : '聞き取りを開始できませんでした。';
      this.fail(message);
      throw new Error(message);
    }
  }
  private createReview(intervalSeconds: number) {
    if (this.callbacks.onReview)
      this.review = new ReviewBuffer(
        (review) => {
          const signal = this.reviewAbort.signal;
          if (this.reviews.size >= 2) {
            this.callbacks.onError('録音の再認識が混み合っているため、Liveの会話を残しています。');
            return;
          }
          const job = this.callbacks.onReview!(review, signal)
            .catch((error) => {
              if (!signal.aborted)
                this.callbacks.onError(
                  error instanceof Error && error.message
                    ? error.message
                    : '録音の再認識に失敗したため、Liveの会話を残しています。',
                );
            })
            .finally(() => {
              this.reviews.delete(job);
              this.publishReviewProgress();
            });
          this.reviews.add(job);
          this.publishReviewProgress();
        },
        () => this.callbacks.onError('長い連続音声のため、この区間はLiveの会話を残しています。'),
        undefined,
        intervalSeconds,
      );
    this.publishReviewProgress();
  }
  private publishReviewProgress() {
    const progress: ReviewProgress = this.reviews.size
      ? { state: 'processing' }
      : (this.review?.progress ?? { state: 'idle' });
    const key = JSON.stringify(progress);
    // 音声チャンクごとの描画を避け、秒数・状態が変わった時だけ通知します。
    if (key === this.reviewProgressKey) return;
    this.reviewProgressKey = key;
    this.callbacks.onReviewProgress?.(progress);
  }
  private async connect(
    settings: Settings,
    sessionId: string,
    generation: number,
    provider: string,
  ) {
    const callbacks = {
      onAudio: (pcm: Uint8Array, capturedAt: number) => {
        this.review?.append(pcm, capturedAt);
        this.publishReviewProgress();
        this.clock.audioSent(pcm.length, capturedAt);
      },
      onBoundary: () => {
        this.flushInterim();
        this.review?.finish();
        this.clock.reset();
        this.createReview(settings.fixIntervalSeconds);
      },
      onUpdating: (updating: boolean) =>
        this.callbacks.onStatus(updating ? 'updating' : 'listening'),
      onError: (message: string) => this.fail(message),
      onUsageError: () =>
        this.callbacks.onError(
          '聞き取りの利用記録を保存できませんでした。次の保存時に再試行します。',
        ),
      onLimit: () => {
        void this.stop();
        this.callbacks.onError(
          '設定した時間に達したため、聞き取りを自動停止しました。続ける場合は「再開」を押してください。',
        );
      },
    };
    const connection =
      provider === 'openai'
        ? new OpenAILiveTranscription(sessionId, settings.vadSilenceMs, {
            ...callbacks,
            onWarning: (message) => this.callbacks.onError(message),
            onText: (text, timestamp, end) => {
              if (generation !== this.generation) return;
              this.interim = '';
              this.callbacks.onInterim('');
              if (text) {
                const id = this.callbacks.onText(text, timestamp, true);
                this.review?.record(id || null, timestamp);
                this.review?.boundary(`${end}s`);
                this.publishReviewProgress();
              }
            },
            onInterim: (text, timestamp) => {
              if (generation !== this.generation) return;
              this.interim = text;
              this.callbacks.onInterim(text, timestamp);
            },
          })
        : new LiveTranscription(sessionId, {
            ...callbacks,
            onMessage: (message) => {
              if (generation === this.generation) this.receiveTranscript(message);
            },
          });
    this.connection = connection;
    await connection.start(settings.listeningLimitMinutes);
  }
  private flushInterim() {
    if (this.applePending.length) {
      const completeUtterance = this.applePending.length === 1;
      this.applePending.forEach((result) => this.commitApple(result, completeUtterance));
      this.applePending = [];
      return;
    }
    if (!this.interim.trim()) return;
    const timestamp = this.clock.final();
    this.callbacks.onInterim('');
    const id = this.callbacks.onText(this.interim.trim(), timestamp, true);
    this.review?.record(id || null, timestamp);
    this.interim = '';
  }
  private appleTimestamp(start: number) {
    return new Date((this.appleEpoch ?? Date.now()) + start * 1000).toISOString();
  }
  private commitApple(result: AppleTranscript, completeUtterance: boolean) {
    const text = result.text.trim();
    this.interim = '';
    this.callbacks.onInterim('');
    if (!text) return;
    const timestamp = this.appleTimestamp(result.start);
    const id = this.callbacks.onText(text, timestamp, completeUtterance);
    this.review?.record(id || null, timestamp);
    this.review?.boundary(`${result.end}s`);
    this.publishReviewProgress();
  }
  private receiveAppleTranscript(result: AppleTranscript) {
    if (result.start < 0 || result.end < result.start || result.finalizedThrough < 0) return;
    const previewRanges = this.applePending;
    // 新しい途中結果だけでは、前の範囲が確定したとは限りません。
    this.applePending = this.applePending.filter(
      (pending) => pending.end <= result.start || pending.start >= result.end,
    );
    this.applePending.push(result);
    this.applePending.sort((a, b) => a.start - b.start);
    const finalized = this.applePending.filter(
      (pending) => pending.final || pending.end <= result.finalizedThrough,
    );
    this.applePending = this.applePending.filter((pending) => !finalized.includes(pending));
    finalized.forEach((pending) =>
      this.commitApple(
        pending,
        previewRanges.every((range) => range.start >= pending.start && range.end <= pending.end),
      ),
    );
    this.interim = this.applePending
      .map((pending) => pending.text.trim())
      .filter(Boolean)
      .join(' ');
    this.callbacks.onInterim(
      this.interim,
      this.applePending.length ? this.appleTimestamp(this.applePending[0].start) : undefined,
    );
  }
  private receiveTranscript(message: LiveServerMessage) {
    this.clock.activity(message.voiceActivity);
    const content = message.serverContent;
    if (content?.interimInputTranscription?.text) {
      this.interim = content.interimInputTranscription.text;
      this.callbacks.onInterim(this.interim, this.clock.interim());
    }
    if (content?.inputTranscription?.text?.trim()) {
      this.interim = '';
      const timestamp = this.clock.final();
      this.callbacks.onInterim('');
      const id = this.callbacks.onText(content.inputTranscription.text.trim(), timestamp, true);
      this.review?.record(id || null, timestamp);
    }
    const activity = message.voiceActivity as
      { type?: string; voiceActivityType?: string; audioOffset?: string } | undefined;
    if ((activity?.type ?? activity?.voiceActivityType) === 'ACTIVITY_END')
      this.review?.boundary(activity?.audioOffset);
    this.publishReviewProgress();
  }
  private fail(message: string) {
    void this.connection?.stop('failed');
    void this.stopNow(true);
    this.callbacks.onStatus('error');
    this.callbacks.onError(message);
  }
  stop(flush = true) {
    if (flush && this.finishing) return this.finishing;
    if (
      flush &&
      ((this.nativeNeedsFinish && this.native) ||
        this.connection instanceof OpenAILiveTranscription)
    ) {
      this.nativeNeedsFinish = false;
      clearTimeout(this.appleLimitTimer);
      const generation = this.generation;
      const nativeFinish = this.native?.finish() ?? Promise.resolve();
      const finishing = nativeFinish
        .catch((error) => {
          if (generation === this.generation)
            this.callbacks.onError(
              error instanceof Error ? error.message : '音声の終了処理に失敗しました。',
            );
        })
        .then(async () => {
          if (generation !== this.generation) return;
          if (this.connection instanceof OpenAILiveTranscription) await this.connection.finish();
          if (generation === this.generation) return this.stopNow(true);
        })
        .finally(() => {
          if (this.finishing === finishing) this.finishing = undefined;
        });
      this.finishing = finishing;
      return finishing;
    }
    return this.stopNow(flush);
  }
  private stopNow(flush: boolean) {
    this.generation++;
    if (flush) {
      this.flushInterim();
      this.review?.finish();
    } else {
      this.reviewAbort.abort();
      this.reviews.clear();
    }
    this.review = undefined;
    this.publishReviewProgress();
    this.interim = '';
    this.applePending = [];
    this.nativeNeedsFinish = false;
    this.appleEpoch = undefined;
    clearTimeout(this.appleLimitTimer);
    this.appleLimitTimer = undefined;
    this.clock.reset();
    const savedUsage = this.connection?.stop() || Promise.resolve();
    this.connection = undefined;
    this.native?.stop();
    this.native = undefined;
    this.worklet?.disconnect();
    this.worklet = undefined;
    this.streams.forEach((stream) =>
      stream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      }),
    );
    this.streams = [];
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.callbacks.onInterim('');
    this.callbacks.onLevel(0);
    this.callbacks.onStatus('idle');
    return Promise.allSettled([savedUsage, ...this.reviews]).then(() => undefined);
  }
}
