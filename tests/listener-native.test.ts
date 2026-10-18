import type { LiveServerMessage } from '@google/genai';
import { afterEach, expect, it, vi } from 'vitest';
import { MeetingListener } from '@/lib/audio/listener';
import { NativeCapture, type AppleTranscript } from '@/lib/audio/native-capture';
import type { AudioReview } from '@/lib/audio/review-buffer';
import { createSession } from '@/lib/session/defaults';
import { api } from '@/lib/api';

vi.mock('@/lib/desktop', () => ({ isDesktop: () => true }));
vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({
    token: 'test-token',
    model: 'test-model',
    config: {},
    usageId: 'test-usage',
  })),
}));
const liveEvents = vi.hoisted(() => ({
  onmessage: null as unknown as (message: LiveServerMessage) => void,
  sendRealtimeInput: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = {
      connect: async ({ callbacks }: { callbacks: typeof liveEvents }) => {
        liveEvents.onmessage = callbacks.onmessage;
        return { close() {}, sendRealtimeInput: liveEvents.sendRealtimeInput };
      },
    };
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  liveEvents.sendRealtimeInput.mockClear();
  vi.useRealTimers();
});

it('混合音声の遅延警告は表示しても聞き取りを停止しない', async () => {
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  let warning!: (message: string) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(
    async (_input, _audio, _error, _apple, onWarning) => {
      warning = onWarning!;
    },
  );
  const stop = vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  vi.spyOn(NativeCapture.prototype, 'finish').mockResolvedValue(undefined);
  const onError = vi.fn();
  const onStatus = vi.fn();
  const listener = new MeetingListener({
    onText: vi.fn(),
    onInterim: vi.fn(),
    onLevel: vi.fn(),
    onError,
    onStatus,
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  warning('音声の一部が遅れて届きました');
  expect(onError).toHaveBeenCalledExactlyOnceWith('音声の一部が遅れて届きました');
  expect(onStatus).toHaveBeenLastCalledWith('listening');
  expect(stop).not.toHaveBeenCalled();
  await listener.stop();
  warning('停止後');
  expect(onError).toHaveBeenCalledOnce();
});

it('Apple Liveで英語の途中・確定結果を受け取り、同じ音声をFixedへ残す', async () => {
  vi.useFakeTimers();
  const epoch = Date.parse('2026-10-05T00:00:01Z');
  vi.setSystemTime(epoch);
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  let transcript!: (result: AppleTranscript) => void;
  const start = vi
    .spyOn(NativeCapture.prototype, 'start')
    .mockImplementation(async (_input, onAudio, _onError, apple) => {
      transcript = apple!.onTranscript;
      onAudio(Buffer.alloc(32000, 7).toString('base64'), 0.2);
    });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  vi.spyOn(NativeCapture.prototype, 'finish').mockResolvedValue(undefined);
  const onText = vi.fn(() => 'english-speech');
  const onInterim = vi.fn();
  const onReview = vi.fn(async () => {});
  const listener = new MeetingListener({
    onText,
    onInterim,
    onReview,
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  session.settings.language = 'en';
  await listener.start(session.settings, session.id);
  expect(start.mock.calls[0][3]?.locale).toBe('en-US');
  expect(liveEvents.sendRealtimeInput).not.toHaveBeenCalled();
  transcript({ text: 'Hello', final: false, start: 0, end: 1, finalizedThrough: 0 });
  expect(onInterim).toHaveBeenLastCalledWith('Hello', new Date(epoch - 1000).toISOString());
  transcript({ text: 'Hello.', final: true, start: 0, end: 1, finalizedThrough: 1 });
  await listener.stop();
  expect(onText).toHaveBeenCalledOnce();
  expect(onText).toHaveBeenCalledWith('Hello.', new Date(epoch - 1000).toISOString(), true);
  expect(onReview).toHaveBeenCalledWith(
    { pcm: new Uint8Array(32000).fill(7), transcriptIds: ['english-speech'] },
    expect.any(AbortSignal),
  );
});

it('Appleの複数の途中範囲を保ち、確定位置を越えるまでは訂正を受け付ける', async () => {
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  let transcript!: (result: AppleTranscript) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(
    async (_input, _audio, _error, apple) => {
      transcript = apple!.onTranscript;
    },
  );
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  vi.spyOn(NativeCapture.prototype, 'finish').mockResolvedValue(undefined);
  const onText = vi.fn();
  const onInterim = vi.fn();
  const listener = new MeetingListener({
    onText,
    onInterim,
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  onInterim.mockClear();
  transcript({ text: 'Ice cream', final: false, start: 0, end: 1, finalizedThrough: 0 });
  transcript({ text: 'again', final: false, start: 1, end: 2, finalizedThrough: 0 });
  expect(onText).not.toHaveBeenCalled();
  expect(onInterim.mock.lastCall?.[0]).toBe('Ice cream again');
  transcript({ text: 'I scream', final: false, start: 0, end: 1, finalizedThrough: 0 });
  expect(onInterim.mock.lastCall?.[0]).toBe('I scream again');
  transcript({ text: 'Final', final: false, start: 2, end: 3, finalizedThrough: 1 });
  expect(onText).not.toHaveBeenCalled();
  expect(onInterim.mock.calls.every(([text]) => text !== '')).toBe(true);
  expect(onInterim.mock.lastCall?.[0]).toBe('I scream again');
  transcript({ text: 'again.', final: true, start: 1, end: 2, finalizedThrough: 2 });
  expect(onText.mock.calls.map(([text]) => text)).toEqual(['I scream again.']);
  expect(onText.mock.lastCall?.[2]).toBe(true);
  expect(onInterim.mock.lastCall?.[0]).toBe('Final');
  transcript({ text: 'Finally.', final: true, start: 2, end: 3, finalizedThrough: 3 });
  expect(onText.mock.calls.map(([text]) => text)).toEqual(['I scream again.', 'Finally.']);
  expect(onText.mock.lastCall?.[2]).toBe(true);
  transcript({ text: 'Next', final: false, start: 3, end: 4, finalizedThrough: 3 });
  expect(onInterim.mock.lastCall?.[0]).toBe('Next');
  await listener.stop();
  expect(onText.mock.calls.map(([text]) => text)).toEqual(['I scream again.', 'Finally.', 'Next']);
});

it.each([
  {
    name: '複数の途中範囲をまとめて確定',
    ranges: [
      [0, 1],
      [1, 2],
    ],
    finalRange: [0, 2],
    complete: true,
  },
  {
    name: '途中範囲を短い最終結果で置換',
    ranges: [[0, 2]],
    finalRange: [0, 1],
    complete: true,
  },
  {
    name: '次の途中範囲が届いて前の範囲が確定',
    ranges: [[0, 1]],
    finalRange: null,
    complete: true,
  },
  {
    name: '複数の途中範囲を確定位置で同時に確定',
    ranges: [
      [0, 1],
      [1, 2],
    ],
    finalRange: null,
    complete: true,
  },
  {
    name: '停止時に一つの途中範囲を確定',
    ranges: [[0, 1]],
    finalRange: null,
    complete: true,
    stop: true,
  },
  {
    name: '停止時に複数の途中範囲をまとめて確定',
    ranges: [
      [0, 1],
      [1, 2],
    ],
    finalRange: null,
    complete: true,
    stop: true,
  },
])('Appleで$nameしたとき、直前の訳を引き継げる範囲を判定する', async (sample) => {
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  let transcript!: (result: AppleTranscript) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(
    async (_input, _audio, _error, apple) => {
      transcript = apple!.onTranscript;
    },
  );
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  vi.spyOn(NativeCapture.prototype, 'finish').mockResolvedValue(undefined);
  const onText = vi.fn();
  const onInterim = vi.fn();
  const listener = new MeetingListener({
    onText,
    onInterim,
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  try {
    for (const [start, end] of sample.ranges)
      transcript({ text: `途中${start}`, final: false, start, end, finalizedThrough: 0 });
    if (sample.stop) await listener.stop();
    else if (sample.finalRange) {
      const [start, end] = sample.finalRange;
      transcript({ text: '訂正した原文。', final: true, start, end, finalizedThrough: end });
    } else {
      const end = Math.max(...sample.ranges.map((range) => range[1]));
      transcript({
        text: '次の発言',
        final: false,
        start: end,
        end: end + 1,
        finalizedThrough: end,
      });
      expect(onInterim.mock.lastCall?.[0]).toBe('次の発言');
    }
    expect(onText).toHaveBeenCalled();
    expect(onText.mock.calls.map((call) => call[2])).toEqual([sample.complete]);
    if (!sample.finalRange)
      expect(onText.mock.calls[0][0]).toBe(
        sample.ranges.map(([start]) => `途中${start}`).join(' '),
      );
  } finally {
    await listener.stop();
  }
});

it('Appleの停止中も最終訂正を待ち、取消・再開後の古い結果を保存しない', async () => {
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  let transcript!: (result: AppleTranscript) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(
    async (_input, _audio, _error, apple) => {
      if (apple) transcript = apple.onTranscript;
    },
  );
  const stop = vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  let complete!: () => void;
  const finish = vi.spyOn(NativeCapture.prototype, 'finish').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const onText = vi.fn();
  const onError = vi.fn();
  const listener = new MeetingListener({
    onText,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError,
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  transcript({ text: 'Wrong', final: false, start: 0, end: 1, finalizedThrough: 0 });
  const stopped = listener.stop();
  expect(listener.stop()).toBe(stopped);
  expect(finish).toHaveBeenCalledOnce();
  expect(onText).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  transcript({ text: 'Right.', final: true, start: 0, end: 1, finalizedThrough: 1 });
  complete();
  await stopped;
  expect(onText.mock.calls.map(([text]) => text)).toEqual(['Right.']);

  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'apple' });
  await listener.start(session.settings, session.id);
  const oldTranscript = transcript;
  transcript({ text: 'Discard', final: false, start: 0, end: 1, finalizedThrough: 0 });
  const cancelled = listener.stop();
  await listener.stop(false);
  complete();
  await cancelled;
  await listener.start(session.settings, session.id);
  oldTranscript({ text: 'Stale.', final: true, start: 0, end: 1, finalizedThrough: 1 });
  complete();
  await cancelled;
  expect(onText.mock.calls.map(([text]) => text)).toEqual(['Right.']);
  expect(onError).not.toHaveBeenCalled();
  await listener.stop(false);
});

it('Fixの処理中・完了後も15秒で区切り、30秒区間を繰り返し送る', async () => {
  vi.useFakeTimers();
  const epoch = Date.parse('2026-10-05T00:00:00Z');
  vi.setSystemTime(epoch);
  let send!: (data: string, level: number) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    send = onData;
  });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  let id = 0;
  const onText = vi.fn(() => `speech-${++id}`);
  const reviews: AudioReview[] = [];
  let completeReview!: () => void;
  const onReview = vi.fn((review: AudioReview) => {
    reviews.push(review);
    return new Promise<void>((resolve) => {
      completeReview = resolve;
    });
  });
  const listener = new MeetingListener({
    onText,
    onReview,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  for (let i = 0; i < 6; i++) {
    vi.setSystemTime(epoch + (i + 1) * 15_000);
    send(Buffer.alloc(15 * 32_000).toString('base64'), 0.2);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_START', audioOffset: `${i * 15}s` },
    } as unknown as LiveServerMessage);
    expect(liveEvents.sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
    liveEvents.onmessage({
      serverContent: { inputTranscription: { text: `発言${i}` } },
    } as LiveServerMessage);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_END', audioOffset: `${(i + 1) * 15}s` },
    } as unknown as LiveServerMessage);
    expect(onText).toHaveBeenLastCalledWith(
      `発言${i}`,
      new Date(epoch + i * 15_000).toISOString(),
      true,
    );
    if (i === 3 || i === 5) {
      completeReview();
      await Promise.resolve();
      await Promise.resolve();
    }
  }
  expect(onReview).toHaveBeenCalledTimes(2);
  vi.setSystemTime(epoch + 95_000);
  send(Buffer.alloc(5 * 32_000).toString('base64'), 0.2);
  expect(onReview).toHaveBeenCalledWith(
    { pcm: expect.any(Uint8Array), transcriptIds: ['speech-5', 'speech-6'] },
    expect.any(AbortSignal),
  );
  expect(reviews[0]?.pcm).toHaveLength(35 * 32_000);
  expect(reviews.map((review) => review.transcriptIds)).toEqual([
    ['speech-1', 'speech-2'],
    ['speech-3', 'speech-4'],
    ['speech-5', 'speech-6'],
  ]);
  completeReview();
  await listener.stop();
});

it.each([
  [15, false],
  [30, false],
  [60, false],
  [120, false],
  [60, true],
] as const)(
  'Fix間隔%s秒を実音声に反映し、停止後も再認識の完了まで計算中を表示する（失敗=%s）',
  async (interval, fails) => {
    vi.useFakeTimers();
    const epoch = Date.parse('2026-10-05T00:00:00Z');
    let send!: (data: string, level: number) => void;
    vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
      send = onData;
    });
    vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
    let complete!: () => void;
    const onReviewProgress = vi.fn();
    const listener = new MeetingListener({
      onText: () => 'speech',
      onInterim: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn(),
      onLevel: vi.fn(),
      onReviewProgress,
      onReview: () =>
        new Promise<void>((resolve, reject) => {
          complete = () => (fails ? reject(new Error('failure')) : resolve());
        }),
    });
    const session = createSession();
    session.settings.fixIntervalSeconds = interval;
    await listener.start(session.settings, session.id);
    vi.setSystemTime(epoch + (interval - 1) * 1000);
    send(Buffer.alloc((interval - 1) * 32000).toString('base64'), 0.2);
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'collecting', remainingSeconds: 1 });
    vi.setSystemTime(epoch + interval * 1000);
    send(Buffer.alloc(32000).toString('base64'), 0.2);
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'boundary' });
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_START', audioOffset: '0s' },
    } as unknown as LiveServerMessage);
    liveEvents.onmessage({
      serverContent: { inputTranscription: { text: '会話です' } },
    } as LiveServerMessage);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_END', audioOffset: `${interval}s` },
    } as unknown as LiveServerMessage);
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'context', elapsedSeconds: 1 });
    vi.setSystemTime(epoch + (interval + 5) * 1000);
    send(Buffer.alloc(5 * 32000).toString('base64'), 0.2);
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'processing' });
    const stopped = listener.stop();
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'processing' });
    complete();
    await stopped;
    expect(onReviewProgress).toHaveBeenLastCalledWith({ state: 'idle' });
  },
);

it.each(['microphone', 'display', 'mixed'] as const)(
  'Macの%s取得へ入力元とコールバックだけを渡す',
  async (input) => {
    vi.spyOn(NativeCapture.prototype, 'finish').mockResolvedValue();
    const start = vi.spyOn(NativeCapture.prototype, 'start').mockResolvedValue();
    vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
    const onStatus = vi.fn();
    const listener = new MeetingListener({
      onText: vi.fn(),
      onInterim: vi.fn(),
      onStatus,
      onError: vi.fn(),
      onLevel: vi.fn(),
    });
    const session = createSession();
    session.settings.input = input;
    try {
      await listener.start(session.settings, session.id);
      expect(start).toHaveBeenCalledWith(
        input,
        expect.any(Function),
        expect.any(Function),
        undefined,
        expect.any(Function),
      );
      expect(onStatus).toHaveBeenLastCalledWith('listening');
    } finally {
      await listener.stop();
    }
  },
);

it('Mac取得の発話開始位置を途中表示と確定結果へ渡す', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T16:00:00.100Z'));
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    onData(Buffer.alloc(3200).toString('base64'), 0.2);
  });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  const onText = vi.fn(),
    onInterim = vi.fn();
  const listener = new MeetingListener({
    onText,
    onInterim,
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  try {
    await listener.start(session.settings, session.id);
    vi.advanceTimersByTime(2000);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_START', audioOffset: '0.400s' },
    } as unknown as LiveServerMessage);
    liveEvents.onmessage({
      serverContent: { interimInputTranscription: { text: 'こんにちは' } },
    } as LiveServerMessage);
    expect(onInterim).toHaveBeenLastCalledWith('こんにちは', '2026-10-04T16:00:00.400Z');
    vi.advanceTimersByTime(3000);
    liveEvents.onmessage({
      serverContent: { inputTranscription: { text: 'こんにちは。' } },
    } as LiveServerMessage);
    expect(onText).toHaveBeenLastCalledWith('こんにちは。', '2026-10-04T16:00:00.400Z', true);
  } finally {
    await listener.stop();
  }
});

it('一度だけ取得したPCMを録音へ分岐し、停止時の未確定発言も再認識する', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:01Z'));
  const start = vi
    .spyOn(NativeCapture.prototype, 'start')
    .mockImplementation(async (_input, onData) => {
      onData(Buffer.alloc(32000, 7).toString('base64'), 0.2);
    });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  const onText = vi.fn(() => 'last-speech');
  const onReview = vi.fn(async () => {});
  const listener = new MeetingListener({
    onText,
    onReview,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  liveEvents.onmessage({
    voiceActivity: { type: 'ACTIVITY_START', audioOffset: '0.2s' },
  } as unknown as LiveServerMessage);
  liveEvents.onmessage({
    serverContent: { interimInputTranscription: { text: '途中の発言です' } },
  } as LiveServerMessage);
  await listener.stop();
  expect(start).toHaveBeenCalledOnce();
  expect(onText).toHaveBeenCalledWith('途中の発言です', '2026-10-05T00:00:00.200Z', true);
  expect(onReview).toHaveBeenCalledWith(
    { pcm: new Uint8Array(32000).fill(7), transcriptIds: ['last-speech'] },
    expect.any(AbortSignal),
  );
  await listener.stop();
  expect(onReview).toHaveBeenCalledOnce();
});
it('画面の破棄時は未確定音声を送らず、進行中の再認識を取り消す', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:01:06Z'));
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    onData(Buffer.alloc(66 * 32000).toString('base64'), 0.2);
  });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  let signal: AbortSignal | undefined;
  const onReview = vi.fn((_review, passedSignal) => {
    signal = passedSignal;
    return new Promise<void>((resolve) => passedSignal.addEventListener('abort', () => resolve()));
  });
  const onText = vi.fn(() => 'first');
  const listener = new MeetingListener({
    onText,
    onReview,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  liveEvents.onmessage({
    voiceActivity: { type: 'ACTIVITY_START', audioOffset: '0.2s' },
  } as unknown as LiveServerMessage);
  liveEvents.onmessage({
    serverContent: { inputTranscription: { text: '確定済み' } },
  } as LiveServerMessage);
  liveEvents.onmessage({
    voiceActivity: { type: 'ACTIVITY_END', audioOffset: '60.5s' },
  } as unknown as LiveServerMessage);
  expect(onReview).toHaveBeenCalledOnce();
  liveEvents.onmessage({
    serverContent: { interimInputTranscription: { text: '未確定' } },
  } as LiveServerMessage);
  await listener.stop(false);
  expect(signal?.aborted).toBe(true);
  expect(onText).toHaveBeenCalledOnce();
  expect(onReview).toHaveBeenCalledOnce();
});

it('再認識の具体的な失敗理由を汎用メッセージで上書きしない', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:01Z'));
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    onData(Buffer.alloc(32000).toString('base64'), 0.2);
  });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  const message = '録音の再認識に失敗したため、Liveの会話を残しています。';
  const onError = vi.fn();
  const listener = new MeetingListener({
    onText: () => 'speech',
    onReview: async () => {
      throw new Error(message);
    },
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError,
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  liveEvents.onmessage({
    serverContent: { interimInputTranscription: { text: '発言です' } },
  } as LiveServerMessage);
  await listener.stop();
  expect(onError).toHaveBeenCalledWith(message);
});

it('再認識が遅い場合は同時2件で止め、Liveの表示と取得を継続する', async () => {
  vi.useFakeTimers();
  const epoch = Date.parse('2026-10-05T00:00:00Z');
  vi.setSystemTime(epoch);
  let send: (data: string, level: number) => void = () => {};
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    send = onData;
  });
  const stop = vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  const onText = vi.fn(() => crypto.randomUUID()),
    onError = vi.fn();
  const onReview = vi.fn(
    (_review, signal) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  );
  const listener = new MeetingListener({
    onText,
    onReview,
    onError,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  await listener.start(session.settings, session.id);
  for (let i = 0; i < 3; i++) {
    vi.setSystemTime(epoch + (i + 1) * 61000);
    send(Buffer.alloc(61 * 32000).toString('base64'), 0.2);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_START', audioOffset: `${i * 61 + 0.2}s` },
    } as unknown as LiveServerMessage);
    liveEvents.onmessage({
      serverContent: { inputTranscription: { text: `発言${i}` } },
    } as LiveServerMessage);
    liveEvents.onmessage({
      voiceActivity: { type: 'ACTIVITY_END', audioOffset: `${(i + 1) * 61}s` },
    } as unknown as LiveServerMessage);
  }
  // 最後の区間の後方5秒が届くと3件目を試みる。
  vi.setSystemTime(epoch + 188000);
  send(Buffer.alloc(5 * 32000).toString('base64'), 0.2);
  expect(onReview).toHaveBeenCalledTimes(2);
  expect(onText).toHaveBeenCalledTimes(3);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('混み合って'));
  expect(stop).not.toHaveBeenCalled();
  await listener.stop(false);
});

it('聞き取りを再開しても前の録音再認識を取り消さず、画面破棄時だけ取り消す', async () => {
  vi.useFakeTimers();
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onData) => {
    onData(Buffer.alloc(32000, 7).toString('base64'), 0.2);
  });
  vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const onReview = vi.fn((_review, passedSignal) => {
    signal = passedSignal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const listener = new MeetingListener({
    onText: vi.fn(() => crypto.randomUUID()),
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
    onReview,
  });
  const session = createSession();
  session.settings.input = 'microphone';
  await listener.start(session.settings, session.id);
  liveEvents.onmessage({
    serverContent: { interimInputTranscription: { text: '前の区間' } },
  } as LiveServerMessage);
  const stopped = listener.stop();
  expect(onReview).toHaveBeenCalledOnce();
  await listener.start(session.settings, session.id);
  expect(signal?.aborted).toBe(false);
  finish();
  await stopped;
  liveEvents.onmessage({
    serverContent: { interimInputTranscription: { text: '次の区間' } },
  } as LiveServerMessage);
  const secondStop = listener.stop();
  expect(onReview).toHaveBeenCalledTimes(2);
  const disposed = listener.stop(false);
  expect(signal?.aborted).toBe(true);
  finish();
  await Promise.all([secondStop, disposed]);
});

it('合成音声は終了時の残りをGeminiへ送ってから接続を閉じる', async () => {
  let send!: (data: string, level: number) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onAudio) => {
    send = onAudio;
  });
  const stop = vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  vi.spyOn(NativeCapture.prototype, 'finish').mockImplementation(async () => {
    expect(stop).not.toHaveBeenCalled();
    send(Buffer.alloc(3200, 1).toString('base64'), 0.1);
  });
  const listener = new MeetingListener({
    onText: vi.fn(),
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  session.settings.input = 'mixed';
  await listener.start(session.settings, session.id);
  await listener.stop();
  expect(liveEvents.sendRealtimeInput).toHaveBeenCalledWith(
    expect.objectContaining({
      audio: expect.objectContaining({ data: Buffer.alloc(3200, 1).toString('base64') }),
    }),
  );
  expect(stop).toHaveBeenCalledOnce();
});

it('OpenAI LiveはNativeの末尾と確定結果を受け取ってからFixedを作る', async () => {
  vi.useFakeTimers();
  const sockets: { onopen?: () => void; onmessage?: (event: { data: string }) => void }[] = [];
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      bufferedAmount = 0;
      constructor() {
        sockets.push(this);
      }
      send() {}
      close() {}
    },
  );
  vi.mocked(api).mockResolvedValueOnce({ liveProvider: 'openai' });
  let sendAudio!: (data: string, level: number) => void;
  vi.spyOn(NativeCapture.prototype, 'start').mockImplementation(async (_input, onAudio) => {
    sendAudio = onAudio;
    onAudio(Buffer.alloc(3200, 7).toString('base64'), 0.2);
  });
  vi.spyOn(NativeCapture.prototype, 'finish').mockImplementation(async () => {
    sendAudio(Buffer.alloc(3200, 7).toString('base64'), 0.2);
  });
  const nativeStop = vi.spyOn(NativeCapture.prototype, 'stop').mockImplementation(() => {});
  const onText = vi.fn(() => 'openai-utterance');
  const onReview = vi.fn(async () => {});
  const listener = new MeetingListener({
    onText,
    onReview,
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onLevel: vi.fn(),
  });
  const session = createSession();
  try {
    const starting = listener.start(session.settings, session.id);
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0];
    const event = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
    socket.onopen?.();
    event({ type: 'session.updated' });
    await starting;
    const stopping = listener.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(nativeStop).not.toHaveBeenCalled();
    event({ type: 'input_audio_buffer.committed', item_id: 'tail' });
    event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'tail',
      transcript: 'Saved tail',
    });
    await stopping;
    expect(onText).toHaveBeenCalledWith('Saved tail', expect.any(String), true);
    expect(onReview).toHaveBeenCalledOnce();
    const review = onReview.mock.calls[0] as unknown as [AudioReview];
    expect(review[0].pcm.length).toBe(6400);
    expect(review[0].transcriptIds).toEqual(['openai-utterance']);
    expect(nativeStop).toHaveBeenCalledOnce();
  } finally {
    await listener.stop(false);
    vi.unstubAllGlobals();
  }
});
