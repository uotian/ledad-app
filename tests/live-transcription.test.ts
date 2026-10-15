import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LiveServerMessage } from '@google/genai';
import { LiveTranscription } from '@/lib/audio/live-transcription';
import { settingsSchema } from '@/lib/session/schema';
import { createSession } from '@/lib/session/defaults';

type Events = {
  onmessage: (message: LiveServerMessage) => void;
  onerror: () => void;
  onclose: () => void;
};
const mock = vi.hoisted(() => ({ connect: vi.fn(), api: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: mock.connect };
  },
}));
vi.mock('@/lib/api', () => ({ api: mock.api }));
let sockets: {
  events: Events;
  close: ReturnType<typeof vi.fn>;
  sendRealtimeInput: ReturnType<typeof vi.fn>;
}[];
let callbacks: ConstructorParameters<typeof LiveTranscription>[1];
let connection: LiveTranscription;
const minute = 60_000;
const data = Buffer.alloc(3200, 7);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  sockets = [];
  mock.api.mockReset().mockImplementation(async (path) =>
    path === '/api/live-token'
      ? {
          token: 'short-token',
          model: 'transcribe-live',
          config: { inputAudioTranscription: { languageCodes: ['ja-JP'] } },
          usageId: crypto.randomUUID(),
        }
      : {},
  );
  mock.connect.mockReset().mockImplementation(async ({ callbacks: events }) => {
    const socket = { events, close: vi.fn(() => events.onclose()), sendRealtimeInput: vi.fn() };
    sockets.push(socket);
    return socket;
  });
  callbacks = {
    onMessage: vi.fn(),
    onAudio: vi.fn(),
    onBoundary: vi.fn(),
    onUpdating: vi.fn(),
    onError: vi.fn(),
    onUsageError: vi.fn(),
    onLimit: vi.fn(),
  };
  connection = new LiveTranscription('meeting-id', callbacks);
});
afterEach(async () => {
  await connection.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const push = () => connection.push(data, data.toString('base64'));
const tokens = () => mock.api.mock.calls.filter(([path]) => path === '/api/live-token');
const activity = (type: string, audioOffset?: string) =>
  ({ voiceActivity: { type, audioOffset } }) as unknown as LiveServerMessage;
const sendSeconds = (seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) push();
};

it('タイマーや開始通知がなくても送信音声15秒ごとに区切り、通算位置をそのまま渡す', async () => {
  await connection.start(30);
  sendSeconds(14.9);
  expect(sockets[0].sendRealtimeInput).not.toHaveBeenCalledWith({ audioStreamEnd: true });
  push();
  expect(sockets[0].sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
  sockets[0].events.onmessage({
    serverContent: { inputTranscription: { text: '前半' } },
  } as LiveServerMessage);
  sockets[0].events.onmessage(activity('ACTIVITY_END', '15s'));
  sockets[0].events.onmessage(activity('ACTIVITY_START', '15.1s'));
  expect(callbacks.onMessage).toHaveBeenLastCalledWith(activity('ACTIVITY_START', '15.1s'));
  sendSeconds(15);
  expect(
    sockets[0].sendRealtimeInput.mock.calls.filter(([input]) => input.audioStreamEnd),
  ).toHaveLength(2);
  sockets[0].events.onmessage(activity('ACTIVITY_END', '30s'));
  expect(callbacks.onMessage).toHaveBeenLastCalledWith(activity('ACTIVITY_END', '30s'));
  expect(sockets).toHaveLength(1);
  expect(callbacks.onMessage).toHaveBeenCalledWith(
    expect.objectContaining({ serverContent: { inputTranscription: { text: '前半' } } }),
  );
});

it('自然な発話終端から15秒で区切り、送信音声がなければ時間だけでは区切らない', async () => {
  await connection.start(30);
  sendSeconds(10);
  sockets[0].events.onmessage(activity('ACTIVITY_END', '10s'));
  await vi.advanceTimersByTimeAsync(30_000);
  sendSeconds(14.9);
  expect(sockets[0].sendRealtimeInput).not.toHaveBeenCalledWith({ audioStreamEnd: true });
  push();
  expect(sockets[0].sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
});

it('遅れた終了・確定通知が次の区切りを遅らせない', async () => {
  await connection.start(30);
  sendSeconds(15);
  sendSeconds(14.9);
  sockets[0].events.onmessage(activity('ACTIVITY_END', '12s'));
  sockets[0].events.onmessage({
    serverContent: { inputTranscription: { text: '最初の区切り' } },
  } as LiveServerMessage);
  expect(
    sockets[0].sendRealtimeInput.mock.calls.filter(([input]) => input.audioStreamEnd),
  ).toHaveLength(1);
  push();
  expect(
    sockets[0].sendRealtimeInput.mock.calls.filter(([input]) => input.audioStreamEnd),
  ).toHaveLength(2);
  expect(sockets[0].sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
});

it('初回接続・接続更新ともに、認識に使わない名前設定を送らない', async () => {
  await connection.start(30);
  await vi.advanceTimersByTimeAsync(9 * minute + 1500);
  expect(tokens()).toHaveLength(2);
  for (const [, options] of tokens())
    expect(JSON.parse(options.body)).toEqual({ sessionId: 'meeting-id' });
});

it('9分で更新し、更新中のPCMを順序と収録時刻を保って一度だけ新接続に送る', async () => {
  await connection.start(30);
  push();
  await vi.advanceTimersByTimeAsync(9 * minute);
  expect(callbacks.onUpdating).toHaveBeenLastCalledWith(true);
  expect(sockets[0].sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
  const capturedAt = Date.now();
  push();
  const final = {
    serverContent: { inputTranscription: { text: '旧接続の最後' } },
  } as LiveServerMessage;
  sockets[0].events.onmessage(final);
  await vi.advanceTimersByTimeAsync(1500);
  expect(tokens()).toHaveLength(2);
  expect(mock.connect.mock.calls[1][0].config.inputAudioTranscription.languageCodes).toEqual([
    'ja-JP',
  ]);
  expect(sockets[0].close).toHaveBeenCalledOnce();
  expect(sockets[1].sendRealtimeInput).toHaveBeenCalledExactlyOnceWith({
    audio: { data: data.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
  });
  expect(callbacks.onAudio).toHaveBeenLastCalledWith(data, capturedAt);
  expect(callbacks.onMessage).toHaveBeenCalledWith(final);
  expect(callbacks.onBoundary).toHaveBeenCalledOnce();
  expect(callbacks.onUpdating).toHaveBeenLastCalledWith(false);
  sockets[0].events.onmessage(final);
  sockets[0].events.onclose();
  expect(callbacks.onMessage).toHaveBeenCalledOnce();
  expect(callbacks.onError).not.toHaveBeenCalled();
  await connection.stop();
  const reports = mock.api.mock.calls
    .filter(([path]) => path === '/api/usage')
    .map(([, options]) => JSON.parse(options.body));
  expect(
    reports.filter((r) => r.status === 'completed').map((r) => [r.sessionId, r.audioInputSeconds]),
  ).toEqual([
    ['meeting-id', 0.1],
    ['meeting-id', 0.1],
  ]);
});

it.each([10, 30, 60, 90] as const)(
  '%s分で止まり、自動更新によって期限が延長されない',
  async (minutes) => {
    await connection.start(minutes);
    await vi.advanceTimersByTimeAsync(minutes * minute - 1);
    expect(callbacks.onLimit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onLimit).toHaveBeenCalledOnce();
    expect(sockets.at(-1)!.close).toHaveBeenCalledOnce();
    const count = tokens().length;
    push();
    await vi.advanceTimersByTimeAsync(20 * minute);
    expect(tokens()).toHaveLength(count);
    expect(callbacks.onError).not.toHaveBeenCalled();
  },
);

it('終了予告の連続受信でも更新は一回だけ、手動停止後は復活しない', async () => {
  await connection.start(30);
  sockets[0].events.onmessage({ goAway: { timeLeft: '20s' } } as LiveServerMessage);
  sockets[0].events.onmessage({ goAway: { timeLeft: '19s' } } as LiveServerMessage);
  await vi.advanceTimersByTimeAsync(1500);
  expect(tokens()).toHaveLength(2);
  await connection.stop();
  await vi.advanceTimersByTimeAsync(40 * minute);
  expect(tokens()).toHaveLength(2);
  expect(callbacks.onLimit).not.toHaveBeenCalled();
});

it('更新の接続待ちがタイムアウトしたら停止し、遅れて開いたソケットも閉じる', async () => {
  await connection.start(30);
  let resolve!: (value: { close: () => void; sendRealtimeInput: () => void }) => void;
  mock.connect.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await vi.advanceTimersByTimeAsync(9 * minute + 1500 + 15_000);
  expect(callbacks.onError).toHaveBeenCalledOnce();
  const close = vi.fn();
  resolve({ close, sendRealtimeInput: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30 * minute);
  expect(tokens()).toHaveLength(2);
  expect(callbacks.onLimit).not.toHaveBeenCalled();
});

it('更新待ちの間に時間上限へ達したら、その後の接続を採用しない', async () => {
  await connection.start(30);
  await vi.advanceTimersByTimeAsync(30 * minute - 2000);
  let resolve!: (value: { close: () => void; sendRealtimeInput: () => void }) => void;
  mock.connect.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  sockets.at(-1)!.events.onmessage({ goAway: { timeLeft: '2s' } } as LiveServerMessage);
  await vi.advanceTimersByTimeAsync(2000);
  expect(callbacks.onLimit).toHaveBeenCalledOnce();
  const close = vi.fn();
  resolve({ close, sendRealtimeInput: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledOnce();
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('タイマーが動かない休止後でも期限を過ぎた音声は送らない', async () => {
  await connection.start(30);
  vi.setSystemTime(Date.now() + 31 * minute);
  push();
  expect(sockets[0].sendRealtimeInput).not.toHaveBeenCalled();
  expect(callbacks.onLimit).toHaveBeenCalledOnce();
});

it('更新中の音声保持には上限があり、接続失敗を無限に再試行しない', async () => {
  await connection.start(30);
  sockets[0].events.onmessage({ goAway: {} } as LiveServerMessage);
  connection.push(Buffer.alloc(21 * 32000), 'test');
  expect(callbacks.onError).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(40 * minute);
  expect(tokens()).toHaveLength(1);
});

it('旧設定は30分へ移行し、指定外の値は受け入れない', () => {
  const legacy: Record<string, unknown> = { ...createSession().settings };
  delete legacy.listeningLimitMinutes;
  expect(settingsSchema.parse(legacy).listeningLimitMinutes).toBe(30);
  expect(settingsSchema.parse({ ...legacy, listeningLimitMinutes: 3 }).listeningLimitMinutes).toBe(
    10,
  );
  for (const value of [10, 30, 60, 90])
    expect(
      settingsSchema.parse({ ...legacy, listeningLimitMinutes: value }).listeningLimitMinutes,
    ).toBe(value);
  for (const value of [0, 120, '60'])
    expect(settingsSchema.safeParse({ ...legacy, listeningLimitMinutes: value }).success).toBe(
      false,
    );
});

it('VADの無音時間は未設定で100msになり、5段階だけ保存できる', () => {
  const legacy: Record<string, unknown> = { ...createSession().settings };
  delete legacy.vadSilenceMs;
  expect(settingsSchema.parse(legacy).vadSilenceMs).toBe(100);
  expect(createSession().settings.vadSilenceMs).toBe(100);
  for (const vadSilenceMs of [50, 100, 200, 300, 500])
    expect(settingsSchema.parse({ ...legacy, vadSilenceMs }).vadSilenceMs).toBe(vadSilenceMs);
  for (const vadSilenceMs of [0, 400, -1, '300', null])
    expect(settingsSchema.safeParse({ ...legacy, vadSilenceMs }).success).toBe(false);
});

it('Fix間隔は旧設定で30秒になり、15・30・60・120秒だけ保存できる', () => {
  const legacy: Record<string, unknown> = { ...createSession().settings };
  delete legacy.fixIntervalSeconds;
  expect(settingsSchema.parse(legacy).fixIntervalSeconds).toBe(30);
  for (const fixIntervalSeconds of [15, 30, 60, 120])
    expect(settingsSchema.parse({ ...legacy, fixIntervalSeconds }).fixIntervalSeconds).toBe(
      fixIntervalSeconds,
    );
  for (const fixIntervalSeconds of [0, 90, 180, -1, '60', null])
    expect(settingsSchema.safeParse({ ...legacy, fixIntervalSeconds }).success).toBe(false);
});
