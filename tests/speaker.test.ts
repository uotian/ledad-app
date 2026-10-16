import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingSpeaker } from '../src/lib/audio/speaker';
import { createSession } from '../src/lib/session/defaults';
import type { Utterance } from '../src/lib/session/schema';
vi.mock('../src/lib/api', () => ({ api: vi.fn(async () => ({ aiMode: 'gemini' })) }));
vi.mock('../src/lib/desktop', () => ({
  serviceFetch: (...args: unknown[]) => fetch(...(args as Parameters<typeof fetch>)),
}));
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  duration = 3;
  src = '';
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  setSinkId = vi.fn().mockRejectedValue(new Error('以前の出力デバイスは利用できません'));
  removeAttribute() {}
  load() {}
  finish() {
    this.currentTime = this.duration;
    this.onended?.();
  }
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function createSpeaker() {
  const records: Utterance[] = [];
  const error = vi.fn();
  const speaker = new MeetingSpeaker({
    onRecord: (r) => records.push(r),
    onStatus: vi.fn(),
    onError: error,
  });
  return { speaker, records, error };
}
beforeEach(() => {
  FakeAudio.instances = [];
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(['audio']) })),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('発話の停止と再開', () => {
  it('古い出力デバイスが保存されていてもOSの既定出力で再生する', async () => {
    const { speaker, error } = createSpeaker();
    const settings = { ...createSession().settings, outputId: 'old-output' };
    speaker.start('確認です。', settings);
    await settle();
    expect(FakeAudio.instances[0].setSinkId).not.toHaveBeenCalled();
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
  it('終了後に届いたTTSを再生しない', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    const { speaker } = createSpeaker();
    speaker.start('質問です。', createSession().settings);
    speaker.stop();
    resolve({ ok: true, blob: async () => new Blob(['audio']) });
    await settle();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(speaker.status).toBe('idle');
  });
  it('停止では聞こえた全文と誤認せず、同じ音声位置から再開する', async () => {
    const { speaker, records } = createSpeaker();
    const candidateId = crypto.randomUUID();
    speaker.start('一つ目の質問です。二つ目の質問です。', createSession().settings, candidateId);
    expect(speaker.candidateId).toBe(candidateId);
    await settle();
    const first = FakeAudio.instances[0];
    first.currentTime = 1.2;
    speaker.pause();
    expect(speaker.candidateId).toBe(candidateId);
    expect(records.at(-1)?.completedText).toBe('');
    expect(records.at(-1)?.status).toBe('interrupted');
    expect(records.at(-1)?.elapsedSeconds).toBe(1.2);
    speaker.resume();
    await settle();
    expect(first.currentTime).toBe(1.2);
    expect(first.play).toHaveBeenCalledTimes(2);
    first.finish();
    await settle();
    expect(records.at(-1)?.completedText).toBe('一つ目の質問です。');
    FakeAudio.instances[1].finish();
    expect(records.at(-1)?.status).toBe('completed');
    expect(records.at(-1)?.completedText).toContain('二つ目の質問です。');
    expect(speaker.candidateId).toBeNull();
  });
  it('別の発言に切り替えると前の音声を解放し、完了後に復帰しない', async () => {
    const { speaker, records } = createSpeaker();
    const settings = createSession().settings;
    speaker.start('最初の発言です。', settings);
    await settle();
    const previous = FakeAudio.instances[0];
    previous.currentTime = 1.5;
    speaker.start('次の発言です。', settings);
    await settle();
    expect(previous.paused).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    FakeAudio.instances[1].finish();
    expect(speaker.canResume).toBe(false);
    expect(speaker.status).toBe('idle');
    expect(records.at(-1)?.kind).toBe('speech');
  });
});

it.each(['Charon', 'marin', 'cedar'] as const)(
  '声設定 %s は次の発言から使い、再生中の声は変えない',
  async (nextVoice) => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const { saveVoice, readVoice } = await import('@/components/settings/voice');
    expect(readVoice()).toBeNull();
    saveVoice('Puck', 'gemini');
    const settings = createSession().settings;
    settings.voice = 'Aoede';
    const { speaker } = createSpeaker();
    const requestedVoice = () =>
      JSON.parse(vi.mocked(fetch).mock.lastCall![1]!.body as string).voice;
    speaker.start('一つ目の文です。二つ目の文です。', settings);
    await settle();
    expect(requestedVoice()).toBe('Puck');
    saveVoice(nextVoice, 'gemini');
    FakeAudio.instances[0].finish();
    await settle();
    expect(requestedVoice()).toBe('Puck');
    FakeAudio.instances[1].finish();
    speaker.start('次の発言です。', settings);
    await settle();
    expect(requestedVoice()).toBe(nextVoice);
    expect(readVoice('gemini')).toBe(nextVoice);
    expect(settings.voice).toBe('Aoede');
    speaker.stop();
  },
);

it('モード取得中に停止した発言を再生しない', async () => {
  const { api } = await import('../src/lib/api');
  let resolve!: (value: { aiMode: string }) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { speaker } = createSpeaker();
  speaker.start('中断します。', createSession().settings);
  speaker.stop();
  resolve({ aiMode: 'openai' });
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(FakeAudio.instances).toHaveLength(0);
});

it('モード取得失敗時に別プロバイダーへフォールバックしない', async () => {
  const { api } = await import('../src/lib/api');
  vi.mocked(api).mockRejectedValueOnce(new Error('設定を読み込めません。'));
  const { speaker, error } = createSpeaker();
  speaker.start('確認します。', createSession().settings);
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('設定を読み込めません。');
});
