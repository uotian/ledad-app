import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenAILiveTranscription, Pcm24k } from '@/lib/audio/openai-live-transcription';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mock.api }));
class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    Socket.instances.push(this);
  }
  event(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
let connection: OpenAILiveTranscription;
let callbacks: ConstructorParameters<typeof OpenAILiveTranscription>[2];
const speech = new Uint8Array(new Int16Array(1600).fill(5000).buffer);
const silence = new Uint8Array(3200);
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  mock.api
    .mockReset()
    .mockImplementation(async (path) =>
      path === '/api/live-token'
        ? { token: 'ephemeral', config: { type: 'transcription' }, usageId: 'usage' }
        : {},
    );
  callbacks = {
    onText: vi.fn(),
    onInterim: vi.fn(),
    onAudio: vi.fn(),
    onBoundary: vi.fn(),
    onUpdating: vi.fn(),
    onError: vi.fn(),
    onWarning: vi.fn(),
    onUsageError: vi.fn(),
    onLimit: vi.fn(),
  };
  connection = new OpenAILiveTranscription('meeting', 100, callbacks);
});
afterEach(async () => {
  await connection.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  const opening = connection.start(30);
  await Promise.resolve();
  const socket = Socket.instances.at(-1)!;
  socket.onopen?.();
  socket.event({ type: 'session.updated' });
  await opening;
  return socket;
}
const commits = (socket: Socket) =>
  socket.send.mock.calls.filter(([text]) => JSON.parse(text).type === 'input_audio_buffer.commit');
const complete = (socket: Socket, id: string, text: string) =>
  socket.event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: id,
    transcript: text,
  });
const acknowledge = (socket: Socket, id: string) =>
  socket.event({ type: 'input_audio_buffer.committed', item_id: id });
it('24 kHzへ変換し、Fixedには元のPCMを渡し、無音と15秒でcommitする', async () => {
  expect(new Pcm24k().convert(speech).length).toBe(4798);
  const socket = await start();
  connection.push(speech);
  connection.push(silence);
  expect(commits(socket)).toHaveLength(1);
  expect(callbacks.onAudio).toHaveBeenCalledWith(speech, expect.any(Number));
  for (let i = 0; i < 150; i++) connection.push(speech);
  expect(commits(socket)).toHaveLength(2);
  const audio = socket.send.mock.calls.map(([text]) => JSON.parse(text)).find((e) => e.audio);
  expect(Buffer.from(audio.audio, 'base64').length).toBe(478);
});
it('順不同の確定を発話順に反映し、重複を無視する', async () => {
  const socket = await start();
  for (const id of ['first', 'second']) {
    connection.push(speech);
    connection.push(silence);
    acknowledge(socket, id);
  }
  complete(socket, 'second', 'Second');
  expect(callbacks.onText).not.toHaveBeenCalled();
  complete(socket, 'first', 'First');
  expect(vi.mocked(callbacks.onText).mock.calls.map((c) => c[0])).toEqual(['First', 'Second']);
  complete(socket, 'first', 'First');
  expect(callbacks.onText).toHaveBeenCalledTimes(2);
  expect(callbacks.onInterim).toHaveBeenLastCalledWith('', expect.any(String));
});
it('停止は末尾の確定を待ち、その間の新しい音声は送らない', async () => {
  const socket = await start();
  connection.push(speech);
  let finished = false;
  const ending = connection.finish().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(commits(socket)).toHaveLength(1);
  acknowledge(socket, 'tail');
  connection.push(speech);
  expect(callbacks.onAudio).toHaveBeenCalledTimes(1);
  expect(finished).toBe(false);
  complete(socket, 'tail', 'Last');
  await ending;
  expect(callbacks.onText).toHaveBeenCalledWith('Last', expect.any(String), 0.1);
});
it('確定待ちの期限で途中結果を残し、利用秒数を保存する', async () => {
  const socket = await start();
  connection.push(speech);
  const ending = connection.finish();
  await Promise.resolve();
  acknowledge(socket, 'tail');
  socket.event({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'tail',
    delta: 'Partial',
  });
  await vi.advanceTimersByTimeAsync(5000);
  await ending;
  expect(callbacks.onText).toHaveBeenCalledWith('Partial', expect.any(String), 0.1);
  expect(callbacks.onWarning).toHaveBeenCalledOnce();
  await connection.stop();
  const reports = mock.api.mock.calls.filter(([path]) => path === '/api/usage');
  const report = JSON.parse(reports.at(-1)![1].body);
  expect(report.status).toBe('completed');
  expect(report.audioInputSeconds).toBeCloseTo(0.11);
});
it('接続失敗と停止後の通知は二重に処理しない', async () => {
  const socket = await start();
  socket.onerror?.();
  socket.onclose?.();
  complete(socket, 'late', 'Ignored');
  expect(callbacks.onError).toHaveBeenCalledOnce();
  expect(callbacks.onText).not.toHaveBeenCalled();
});

it('細かい不均等チャンクでもリサンプリングの位相を保持する', () => {
  const expected = new Pcm24k().convert(speech);
  const converter = new Pcm24k();
  const parts = [];
  for (let offset = 0; offset < speech.length; offset += 62)
    parts.push(...converter.convert(speech.subarray(offset, offset + 62)));
  expect(Uint8Array.from(parts)).toEqual(expected);
});

it('接続更新中の音声を新接続へ順序を保って送る', async () => {
  await start();
  await vi.advanceTimersByTimeAsync(3 * 60_000);
  expect(Socket.instances).toHaveLength(2);
  connection.push(speech);
  expect(callbacks.onAudio).not.toHaveBeenCalled();
  const next = Socket.instances[1];
  next.onopen?.();
  next.event({ type: 'session.updated' });
  await vi.advanceTimersByTimeAsync(0);
  expect(callbacks.onAudio).toHaveBeenCalledOnce();
  expect(callbacks.onBoundary).toHaveBeenCalledOnce();
  expect(callbacks.onUpdating).toHaveBeenLastCalledWith(false);
});

it('更新中に停止しても保持した音声を送って末尾を確定する', async () => {
  await start();
  await vi.advanceTimersByTimeAsync(3 * 60_000);
  connection.push(speech);
  const finish = connection.finish();
  const next = Socket.instances[1];
  next.onopen?.();
  next.event({ type: 'session.updated' });
  await vi.advanceTimersByTimeAsync(0);
  expect(commits(next)).toHaveLength(1);
  acknowledge(next, 'tail');
  complete(next, 'tail', 'Retained');
  await finish;
  expect(callbacks.onText).toHaveBeenCalledWith('Retained', expect.any(String), 0.1);
});

it('接続開始を取り消した後の通知を無視する', async () => {
  const opening = connection.start(30);
  await Promise.resolve();
  const socket = Socket.instances[0];
  await connection.stop('cancelled');
  socket.onopen?.();
  socket.event({ type: 'session.updated' });
  await opening;
  expect(socket.send).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('確定全文が途中結果と異なる場合は、追記せず確定全文へ置き換える', async () => {
  const socket = await start();
  connection.push(speech);
  socket.event({
    type: 'conversation.item.input_audio_transcription.delta', item_id: 'revision', delta: '交渉',
  });
  expect(callbacks.onInterim).toHaveBeenLastCalledWith('交渉', expect.any(String));
  connection.push(silence);
  acknowledge(socket, 'revision');
  complete(socket, 'revision', '鉱床');
  expect(callbacks.onText).toHaveBeenCalledExactlyOnceWith('鉱床', expect.any(String), .2);
  expect(callbacks.onInterim).toHaveBeenLastCalledWith('', expect.any(String));
});
