import { afterEach, expect, it, vi } from 'vitest';
import { MeetingListener } from '@/lib/audio/listener';
import { createSession } from '@/lib/session/defaults';

vi.mock('@/lib/desktop', () => ({ isDesktop: () => false }));
vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({ liveProvider: 'gemini' })) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ['development', '1', false],
  ['development', '', true],
  ['production', '1', true],
] as const)('音声なしテストは開発時の明示設定だけで有効: %s / %s', async (env, flag, capture) => {
  vi.stubEnv('NODE_ENV', env);
  vi.stubEnv('NEXT_PUBLIC_LEDAD_DISABLE_AUDIO_CAPTURE', flag);
  const getUserMedia = vi.fn().mockRejectedValue(new Error('テスト用の権限拒否'));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const onError = vi.fn();
  const listener = new MeetingListener({
    onText: vi.fn(),
    onInterim: vi.fn(),
    onStatus: vi.fn(),
    onError,
    onLevel: vi.fn(),
  });
  const session = createSession();
  session.settings.input = 'microphone';
  if (capture) {
    await expect(listener.start(session.settings, session.id)).rejects.toThrow(
      'テスト用の権限拒否',
    );
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia.mock.calls[0][0].audio).not.toHaveProperty('deviceId');
  } else {
    await listener.start(session.settings, session.id);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  }
});

vi.mock('@/lib/audio/live-transcription', () => ({
  LiveTranscription: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    push = vi.fn();
  },
}));

function browserAudio() {
  const track = (kind: string) => ({ kind, stop: vi.fn(), onended: null as null | (() => void) });
  const displayAudio = track('audio'),
    video = track('video'),
    microphone = track('audio');
  class Stream {
    constructor(private tracks: ReturnType<typeof track>[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === 'audio');
    }
  }
  const display = new Stream([displayAudio, video]);
  const mic = new Stream([microphone]);
  const getDisplayMedia = vi.fn(async () => display);
  const getUserMedia = vi.fn(async () => mic);
  const node = () => ({
    connect: vi.fn((target) => target),
    disconnect: vi.fn(),
    gain: { value: 1 },
    channelCount: 2,
    channelCountMode: 'max',
  });
  const gains: ReturnType<typeof node>[] = [];
  const sources: ReturnType<typeof node>[] = [];
  const close = vi.fn(async () => {});
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia, getUserMedia } });
  vi.stubGlobal('MediaStream', Stream);
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = vi.fn(async () => {});
      close = close;
      destination = node();
      audioWorklet = { addModule: vi.fn(async () => {}) };
      createGain() {
        const gain = node();
        gains.push(gain);
        return gain;
      }
      createMediaStreamSource() {
        const source = node();
        sources.push(source);
        return source;
      }
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null };
      connect = vi.fn((target) => target);
      disconnect = vi.fn();
    },
  );
  const onStatus = vi.fn(),
    onError = vi.fn();
  const listener = new MeetingListener({
    onText: vi.fn(),
    onInterim: vi.fn(),
    onStatus,
    onError,
    onLevel: vi.fn(),
  });
  const session = createSession();
  session.settings.input = 'mixed';
  return {
    listener,
    session,
    getDisplayMedia,
    getUserMedia,
    display,
    mic,
    displayAudio,
    video,
    microphone,
    gains,
    sources,
    close,
    onStatus,
    onError,
  };
}

it.each(['stop', 'display', 'microphone'] as const)(
  '双方を同じモノラル入力に混ぜ、%s終了時は全トラックを解放する',
  async (end) => {
    const audio = browserAudio();
    await audio.listener.start(audio.session.settings, audio.session.id);
    expect(audio.getDisplayMedia).toHaveBeenCalledOnce();
    expect(audio.getUserMedia).toHaveBeenCalledOnce();
    expect(audio.sources).toHaveLength(2);
    expect(audio.gains[0]).toMatchObject({
      gain: { value: 0.5 },
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    for (const source of audio.sources) expect(source.connect).toHaveBeenCalledWith(audio.gains[0]);
    expect(audio.gains[1].gain.value).toBe(0);
    expect(audio.onStatus).toHaveBeenLastCalledWith('listening');
    if (end === 'stop') await audio.listener.stop();
    else (end === 'display' ? audio.displayAudio : audio.microphone).onended!();
    for (const track of [audio.displayAudio, audio.video, audio.microphone]) {
      expect(track.stop).toHaveBeenCalledOnce();
      expect(track.onended).toBeNull();
    }
    expect(audio.close).toHaveBeenCalledOnce();
    expect(audio.onStatus).toHaveBeenLastCalledWith(end === 'stop' ? 'idle' : 'error');
  },
);

it('マイク許可の拒否時は取得済みのPC音声も停止する', async () => {
  const audio = browserAudio();
  audio.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await expect(audio.listener.start(audio.session.settings, audio.session.id)).rejects.toThrow(
    '音声の許可',
  );
  expect(audio.displayAudio.stop).toHaveBeenCalledOnce();
  expect(audio.video.stop).toHaveBeenCalledOnce();
  expect(audio.onStatus).toHaveBeenLastCalledWith('error');
  expect(audio.sources).toHaveLength(0);
});

it('マイク許可待ちで中断した場合は、遅れて得られたマイクも停止する', async () => {
  const audio = browserAudio();
  let resolve!: (stream: typeof audio.mic) => void;
  audio.getUserMedia.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const start = audio.listener.start(audio.session.settings, audio.session.id);
  await vi.waitFor(() => expect(audio.getUserMedia).toHaveBeenCalledOnce());
  await audio.listener.stop();
  resolve(audio.mic);
  await start;
  expect(audio.displayAudio.stop).toHaveBeenCalledOnce();
  expect(audio.microphone.stop).toHaveBeenCalledOnce();
  expect(audio.sources).toHaveLength(0);
  expect(audio.onStatus).toHaveBeenLastCalledWith('idle');
});

it('共有音声がない場合はマイクだけで続行しない', async () => {
  const audio = browserAudio();
  vi.spyOn(audio.display, 'getAudioTracks').mockReturnValue([]);
  await expect(audio.listener.start(audio.session.settings, audio.session.id)).rejects.toThrow(
    '共有元の音声',
  );
  expect(audio.video.stop).toHaveBeenCalledOnce();
  expect(audio.getUserMedia).not.toHaveBeenCalled();
});
