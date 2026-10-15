import { afterEach, expect, it, vi } from 'vitest';
import { NativeCapture, type AppleTranscript } from '@/lib/audio/native-capture';

const bridge = vi.hoisted(() => ({
  event: null as unknown as (event: { payload: Record<string, unknown> }) => void,
  captureId: '',
  unlisten: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name, handler) => {
    bridge.event = handler;
    return bridge.unlisten;
  }),
}));
vi.mock('@/lib/desktop', () => ({ desktopInvoke: bridge.invoke }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
function emit(payload: Record<string, unknown>) {
  bridge.event({ payload: { captureId: bridge.captureId, ...payload } });
}
async function start() {
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === 'start_capture') {
      bridge.captureId = args.captureId;
      emit({ type: 'ready' });
    }
  });
  const capture = new NativeCapture();
  const onTranscript = vi.fn<(result: AppleTranscript) => void>();
  const onAudio = vi.fn();
  const onError = vi.fn();
  const onWarning = vi.fn();
  await capture.start('microphone', onAudio, onError, { locale: 'en-US', onTranscript }, onWarning);
  return { capture, onTranscript, onAudio, onError, onWarning };
}
it('音声遅延の警告は取得と終了待ちを止めず、古い取得の警告は無視する', async () => {
  const { capture, onAudio, onError, onWarning } = await start();
  const stopping = capture.finish();
  emit({ type: 'warning', message: '遅延', captureId: crypto.randomUUID() });
  expect(onWarning).not.toHaveBeenCalled();
  emit({ type: 'warning', message: '遅延' });
  emit({ type: 'audio', data: 'AAAA', level: 0.5 });
  expect(onWarning).toHaveBeenCalledExactlyOnceWith('遅延');
  expect(onError).not.toHaveBeenCalled();
  expect(onAudio).toHaveBeenCalledExactlyOnceWith('AAAA', 0.5);
  emit({ type: 'finished' });
  await stopping;
  capture.stop();
  emit({ type: 'warning', message: '停止後' });
  expect(onWarning).toHaveBeenCalledOnce();
});
it('終了通知まで最後の結果を受け付け、停止後は無視する', async () => {
  const { capture, onTranscript } = await start();
  let finished = false;
  const stopping = capture.finish().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  emit({
    type: 'transcript',
    text: 'Corrected.',
    final: true,
    start: 0,
    end: 1,
    finalizedThrough: 1,
  });
  expect(onTranscript).toHaveBeenCalledOnce();
  emit({
    type: 'transcript',
    text: 'Invalid.',
    final: true,
    start: 0,
    end: 1,
    finalizedThrough: Infinity,
  });
  expect(onTranscript).toHaveBeenCalledOnce();
  emit({ type: 'finished', captureId: crypto.randomUUID() });
  await Promise.resolve();
  expect(finished).toBe(false);
  emit({ type: 'finished' });
  await stopping;
  capture.stop();
  expect(bridge.unlisten).toHaveBeenCalledOnce();
  emit({ type: 'transcript', text: 'Late.', final: true, start: 0, end: 1, finalizedThrough: 1 });
  expect(onTranscript).toHaveBeenCalledOnce();
});
it('最終確定が来なくても8秒で戻り、明示的な取消はすぐ終了する', async () => {
  vi.useFakeTimers();
  const { capture } = await start();
  const timeout = expect(capture.finish()).rejects.toThrow('終了処理を待ちきれなかった');
  await vi.advanceTimersByTimeAsync(8_000);
  await timeout;
  const cancellation = expect(capture.finish()).rejects.toMatchObject({ name: 'AbortError' });
  capture.stop();
  await cancellation;
  expect(vi.getTimerCount()).toBe(0);
});
it('確定待ち中の音声エラーは待たずに返す', async () => {
  const { capture } = await start();
  const failure = expect(capture.finish()).rejects.toThrow('入力が終了しました');
  emit({ type: 'error', message: '入力が終了しました' });
  await failure;
  capture.stop();
});
