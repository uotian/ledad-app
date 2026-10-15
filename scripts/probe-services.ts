import { mkdir, writeFile } from 'node:fs/promises';
import { GoogleGenAI, type LiveConnectConfig } from '@google/genai';
import { pythonService } from './python-service';
import type { Session } from '../src/lib/session/schema';
async function main() {
  const service = pythonService('.data/probe');
  let closeLive = () => {};
  try {
    await mkdir('artifacts', { recursive: true });
    const session = await service.json<Session>('/api/sessions', 'POST', { mode: 'audience' });
    const start = Date.now();
    const answer = await service.json(`/api/sessions/${session.id}/translate`, 'POST', {
      text: '接続確認です。こんにちは。',
      translationLanguage: 'en',
    });
    console.log('OpenAI', answer, `${Date.now() - start} ms`);
    const audioStart = Date.now();
    const speech = await service.request('/api/speech', 'POST', {
      sessionId: session.id,
      text: 'こんにちは。新しいシステムの導入費用はいくらですか。',
      language: 'ja',
      voice: 'Kore',
    });
    const audio = {
      bytes: Buffer.from(await speech.arrayBuffer()),
      mime: speech.headers.get('content-type'),
    };
    await writeFile('artifacts/probe-speech.wav', audio.bytes);
    console.log(
      'Gemini TTS',
      audio.mime,
      audio.bytes.length,
      `${Date.now() - audioStart} ms`,
      'header',
      audio.bytes.subarray(0, 4).toString(),
    );
    const token = await service.json<{
      token: string;
      model: string;
      config: LiveConnectConfig;
      usageId: string;
    }>('/api/live-token', 'POST', { sessionId: session.id });
    console.log('Ephemeral token', Boolean(token.token), token.model);
    const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: 'v1beta' } });
    let resolveText: () => void = () => {};
    const received = new Promise<void>((r) => {
      resolveText = r;
    });
    const live = await ai.live.connect({
      model: token.model,
      config: token.config,
      callbacks: {
        onmessage: (message) => {
          if (message.serverContent?.inputTranscription) {
            console.log('Gemini STT final', message.serverContent.inputTranscription.text);
            resolveText();
          }
        },
        onerror: () => console.log('STT error'),
        onclose: (e) => console.log('STT closed', e.code),
      },
    });
    closeLive = () => live.close();
    const wav = audio.bytes;
    let offset = 12,
      pcm = Buffer.alloc(0),
      rate = 24000;
    while (offset + 8 < wav.length) {
      const size = wav.readUInt32LE(offset + 4);
      const name = wav.toString('ascii', offset, offset + 4);
      if (name === 'fmt ') rate = wav.readUInt32LE(offset + 12);
      if (name === 'data') {
        pcm = wav.subarray(offset + 8, offset + 8 + size);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!pcm.length) throw new Error('WAV data chunk missing');
    const resampled = Buffer.alloc(Math.floor(((pcm.length / 2) * 16000) / rate) * 2);
    for (let i = 0; i < resampled.length / 2; i++)
      resampled.writeInt16LE(pcm.readInt16LE(Math.floor((i * rate) / 16000) * 2), i * 2);
    for (let i = 0; i < resampled.length; i += 3200) {
      live.sendRealtimeInput({
        audio: {
          data: resampled.subarray(i, i + 3200).toString('base64'),
          mimeType: 'audio/pcm;rate=16000',
        },
      });
      await new Promise((r) => setTimeout(r, 100));
    }
    live.sendRealtimeInput({ audioStreamEnd: true });
    await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('STT timeout')), 20_000).unref()),
    ]);
    live.close();
    await service.json('/api/usage', 'POST', {
      id: token.usageId,
      sessionId: session.id,
      status: 'completed',
      audioInputSeconds: resampled.length / 32000,
      liveReports: [],
    });
    console.log('All services OK');
  } finally {
    closeLive();
    await service.close();
  }
}
main().catch((e) => {
  console.error(
    'Probe failed',
    e.name,
    e.status || '',
    e.message?.replace(/AIza\S+|sk-\S+/g, '[REDACTED]').slice(0, 1000),
  );
  process.exitCode = 1;
});
