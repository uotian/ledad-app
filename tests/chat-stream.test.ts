import { describe, expect, it } from 'vitest';
import { readServiceStream } from '@/lib/desktop';

const encoder = new TextEncoder();
const envelope = (status = 200) =>
  JSON.stringify({
    status,
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(status === 200 ? { reply: '完成です' } : { error: '失敗' }),
    ).toString('base64'),
  }) + '\n';
function stream(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
}

describe('Chat stream', () => {
  it('reads split UTF-8 and multiple messages, and requires a terminal envelope', async () => {
    const bytes = encoder.encode(JSON.stringify({ text: '途中です' }) + '\n' + envelope());
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    const partials: string[] = [];
    const result = await readServiceStream(stream(chunks), (text) => partials.push(text));
    expect(partials).toEqual(['途中です']);
    expect(await result.json()).toEqual({ reply: '完成です' });
  });
  it.each(['', '{"text":"途中"}\n', '{"text":"途中"}\n{"status":200'])(
    'rejects truncated streams: %s',
    async (body) => {
      await expect(readServiceStream(stream([encoder.encode(body)]), () => {})).rejects.toThrow(
        '途中で切れ',
      );
    },
  );
  it('preserves the final error and never treats the preview as a result', async () => {
    const result = await readServiceStream(
      stream([encoder.encode('{"text":"途中"}\n' + envelope(502))]),
      () => {},
    );
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: '失敗' });
  });
  it('discards data arriving after cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    const partials: string[] = [];
    await expect(
      readServiceStream(
        stream([encoder.encode('{"text":"途中"}\n' + envelope())]),
        (text) => partials.push(text),
        abort.signal,
      ),
    ).rejects.toThrow('取消');
    expect(partials).toEqual([]);
  });
});
