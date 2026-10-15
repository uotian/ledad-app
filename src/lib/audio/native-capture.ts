import { desktopInvoke } from '@/lib/desktop';
import type { UnlistenFn } from '@tauri-apps/api/event';
type AudioEvent = {
  captureId: string;
  type: 'ready' | 'audio' | 'transcript' | 'finished' | 'error' | 'warning';
  data?: string;
  level?: number;
  message?: string;
  text?: string;
  final?: boolean;
  start?: number;
  end?: number;
  finalizedThrough?: number;
};
export type AppleTranscript = {
  text: string;
  final: boolean;
  start: number;
  end: number;
  finalizedThrough: number;
};
export class NativeCapture {
  private unlisten: UnlistenFn | null = null;
  private cancel: (() => void) | null = null;
  private generation = 0;
  private captureId = crypto.randomUUID();
  private finishWait?: { resolve: () => void; reject: (error: Error) => void };
  async start(
    source: string,
    onAudio: (data: string, level: number) => void,
    onError: (message: string) => void,
    apple?: { locale: string; onTranscript: (result: AppleTranscript) => void },
    onWarning?: (message: string) => void,
  ) {
    const generation = ++this.generation;
    const { listen } = await import('@tauri-apps/api/event');
    if (generation !== this.generation) throw new DOMException('取消', 'AbortError');
    let ready = false;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const readiness = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // listenの準備中に取り消されても未処理のPromise拒否にしません。
    void readiness.catch(() => {});
    const timer = setTimeout(
      () =>
        rejectReady(
          new Error(
            apple
              ? 'Appleの言語モデルを準備できませんでした。接続を確認して再試行してください。'
              : '音声の許可を確認してください。システム設定でledadを許可した後、再試行できます。',
          ),
        ),
      apple ? 180_000 : 60_000,
    );
    this.cancel = () => rejectReady(new DOMException('取消', 'AbortError'));
    try {
      const unlisten = await listen<AudioEvent>('native-audio', ({ payload }) => {
        if (generation !== this.generation || payload.captureId !== this.captureId) return;
        if (payload.type === 'ready') {
          ready = true;
          resolveReady();
        } else if (payload.type === 'audio' && payload.data)
          onAudio(payload.data, payload.level || 0);
        else if (
          payload.type === 'transcript' &&
          apple &&
          typeof payload.text === 'string' &&
          typeof payload.final === 'boolean' &&
          Number.isFinite(payload.start) &&
          Number.isFinite(payload.end) &&
          Number.isFinite(payload.finalizedThrough)
        )
          apple.onTranscript(payload as AppleTranscript);
        else if (payload.type === 'warning' && payload.message) onWarning?.(payload.message);
        else if (payload.type === 'finished') this.finishWait?.resolve();
        else if (payload.type === 'error') {
          const message = payload.message || '音声入力に失敗しました。';
          this.finishWait?.reject(new Error(message));
          if (ready) onError(message);
          else rejectReady(new Error(message));
        }
      });
      if (generation !== this.generation) {
        unlisten();
        throw new DOMException('取消', 'AbortError');
      }
      this.unlisten = unlisten;
      await desktopInvoke('start_capture', {
        source,
        captureId: this.captureId,
        appleLocale: apple?.locale ?? '',
      });
      await readiness;
    } catch (error) {
      this.stop();
      throw error instanceof Error ? error : new Error('Macの音声処理を起動できませんでした。');
    } finally {
      clearTimeout(timer);
      this.cancel = null;
    }
  }
  async finish() {
    let timer!: ReturnType<typeof setTimeout>;
    const finished = new Promise<void>((resolve, reject) => {
      this.finishWait = { resolve, reject };
      timer = setTimeout(
        () =>
          reject(new Error('音声の終了処理を待ちきれなかったため、表示済みの会話を残しました。')),
        8_000,
      );
    });
    void finished.catch(() => {});
    try {
      await desktopInvoke('finish_capture', { captureId: this.captureId });
      await finished;
    } finally {
      clearTimeout(timer);
      this.finishWait = undefined;
    }
  }
  stop() {
    this.generation++;
    this.finishWait?.reject(new DOMException('取消', 'AbortError'));
    this.cancel?.();
    this.cancel = null;
    this.unlisten?.();
    this.unlisten = null;
    void desktopInvoke('stop_capture', { captureId: this.captureId }).catch(() => {});
  }
}
