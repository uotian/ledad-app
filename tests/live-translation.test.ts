import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveTranslation, type TranslationDraft } from '@/lib/session/live-translation';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const requests: {
    text: string;
    previous: TranslationDraft | null;
    resolve: (value: string) => void;
    reject: () => void;
  }[] = [];
  const display = vi.fn();
  const unused = vi.fn();
  const worker = new LiveTranslation(
    'en',
    (text, language, previous) => {
      expect(language).toBe('en');
      return new Promise<{ text: string; usageId: string }>((resolve, reject) => {
        const usageId = `usage-${requests.length + 1}`;
        requests.push({
          text,
          previous,
          resolve: (value) => resolve({ text: value, usageId }),
          reject: () => reject(new Error('offline')),
        });
      });
    },
    display,
    unused,
  );
  return { worker, requests, display, unused };
}
it('送信は1件ずつ行い、待機中の原稿は最新にまとめて直前の訳を引き継ぐ', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('a');
  for (const text of ['ab', 'abc', 'abcd', 'abcde']) worker.update(text);
  worker.update(' abcde ');
  expect(requests).toHaveLength(1);
  requests[0].resolve('A');
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({
    text: 'abcde',
    previous: { text: 'a', translation: 'A' },
  });
  requests[1].resolve('ABCDE');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('abcde');
  expect(requests).toHaveLength(2);
  expect(display.mock.calls).toEqual([
    ['A', 'a'],
    ['ABCDE', 'abcde'],
  ]);
  expect(unused).not.toHaveBeenCalled();
  worker.reset();
});
it('原文が伸び続けても返った訳を表示し、次の原稿へその訳を渡す', async () => {
  const { worker, requests, display } = setup();
  worker.update('a');
  worker.update('ab');
  requests[0].resolve('A');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).toHaveBeenLastCalledWith('A', 'a');
  worker.update('abc');
  worker.update('abcd');
  expect(requests).toHaveLength(2);
  requests[1].resolve('AB');
  await vi.advanceTimersByTimeAsync(0);
  expect(requests[2]).toMatchObject({
    text: 'abcd',
    previous: { text: 'ab', translation: 'AB' },
  });
  requests[2].resolve('ABCD');
  await vi.advanceTimersByTimeAsync(0);
  expect(display.mock.calls).toEqual([
    ['A', 'a'],
    ['AB', 'ab'],
    ['ABCD', 'abcd'],
  ]);
  worker.reset();
});
it('応答が返れば、表示した原文と訳文を次のリクエストへ渡す', async () => {
  const { worker, requests } = setup();
  worker.update('a');
  requests[0].resolve('A');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('ab');
  expect(requests).toHaveLength(2);
  expect(requests[1].previous).toEqual({ text: 'a', translation: 'A' });
  worker.reset();
});
it('空の結果で表示を消し、次のリクエストに古い訳を渡さない', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('来週');
  requests[0].resolve('Next week');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('Next Friday');
  worker.update('Next Friday at noon');
  requests[1].resolve('');
  await vi.advanceTimersByTimeAsync(0);
  expect(display.mock.calls).toEqual([
    ['Next week', '来週'],
    ['', 'Next Friday'],
  ]);
  expect(unused.mock.calls).toEqual([['usage-2']]);
  expect(requests[2]).toMatchObject({ text: 'Next Friday at noon', previous: null });
  worker.reset();
});
it('表示しなくなった発話の応答も受け取り、不利用として記録する', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('a');
  requests[0].resolve('A');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('ab');
  worker.update('');
  worker.update('b');
  expect(requests[2].previous).toBeNull();
  requests[2].resolve('B');
  await vi.advanceTimersByTimeAsync(0);
  requests[1].resolve('AB');
  await vi.advanceTimersByTimeAsync(0);
  expect(display.mock.calls).toEqual([
    ['A', 'a'],
    ['', ''],
    ['B', 'b'],
  ]);
  expect(unused).toHaveBeenCalledWith('usage-2');
  worker.reset();
});
it('確定した発話には処理中のLive訳を引き渡し、プレビューには表示しない', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('来週は金曜日');
  const pending = worker.handoff();
  worker.reset();
  requests[0].resolve('Next Friday');
  await expect(pending).resolves.toEqual({ text: 'Next Friday', usageId: 'usage-1' });
  await vi.advanceTimersByTimeAsync(0);
  expect(display).not.toHaveBeenCalled();
  expect(unused).not.toHaveBeenCalled();
});
it('複数の引き渡し後に応答が逆順で届いても、破棄した訳だけ一度記録する', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('first');
  const first = worker.handoff();
  worker.update('second');
  const second = worker.handoff();
  worker.update('discarded');
  worker.reset();
  worker.reset();
  worker.update('current');
  requests[3].resolve('CURRENT');
  requests[2].resolve('DISCARDED');
  requests[1].resolve('SECOND');
  requests[0].resolve('FIRST');
  await expect(first).resolves.toEqual({ text: 'FIRST', usageId: 'usage-1' });
  await expect(second).resolves.toEqual({ text: 'SECOND', usageId: 'usage-2' });
  await vi.advanceTimersByTimeAsync(0);
  expect(display.mock.calls).toEqual([['CURRENT', 'current']]);
  expect(unused.mock.calls).toEqual([['usage-3']]);
  expect(requests).toHaveLength(4);
  worker.reset();
});
it('確定時に原稿が伸びていれば途中までの応答を引き渡さず、待機原稿も送信しない', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('来週');
  worker.update('来週は金曜日');
  expect(requests).toHaveLength(1);
  expect(worker.handoff()).toBeNull();
  requests[0].resolve('Next week');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).not.toHaveBeenCalled();
  expect(unused.mock.calls).toEqual([['usage-1']]);
  expect(requests).toHaveLength(1);
});
it('Appleの途中表示の一部だけ確定した場合は、全体の訳を引き渡さない', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('最初の発言 続きの発言');
  expect(worker.handoff('最初の発言')).toBeNull();
  requests[0].resolve('First remark. Following remark.');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).not.toHaveBeenCalled();
  expect(unused).toHaveBeenCalledWith('usage-1');
});
it('Geminiが発言全体を確定した場合は原文が変わっても処理中の訳を引き渡す', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('こんにちは');
  requests[0].resolve('Hello');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('こんにちは皆さん');
  worker.update('こんにちは皆さんお元気ですか');
  const pending = worker.handoff('こんにちは、皆さん。お元気ですか？', true);
  requests[1].resolve('Hello everyone');
  await expect(pending).resolves.toEqual({ text: 'Hello everyone', usageId: 'usage-2' });
  await vi.advanceTimersByTimeAsync(0);
  expect(display.mock.calls).toEqual([['Hello', 'こんにちは']]);
  expect(requests).toHaveLength(2);
  expect(unused).not.toHaveBeenCalled();
});
it('失敗したリクエストで前回訳を置き換えず、次の原稿で回復する', async () => {
  const { worker, requests, display } = setup();
  worker.update('a');
  requests[0].resolve('A');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('ab');
  worker.update('abc');
  requests[1].reject();
  await vi.advanceTimersByTimeAsync(0);
  worker.update('abc');
  expect(requests[2].previous).toEqual({ text: 'a', translation: 'A' });
  requests[2].resolve('ABC');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).toHaveBeenLastCalledWith('ABC', 'abc');
  worker.reset();
});

it('旧リクエストの終了が新しい発言を解除せず、古い訳も表示しない', async () => {
  const { worker, requests, display, unused } = setup();
  worker.update('old');
  worker.reset();
  worker.update('new');
  worker.update('newer');
  requests[0].resolve('OLD');
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(2);
  expect(display).not.toHaveBeenCalled();
  expect(unused).toHaveBeenCalledWith('usage-1');
  requests[1].resolve('NEW');
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(3);
  expect(requests[2]).toMatchObject({
    text: 'newer',
    previous: { text: 'new', translation: 'NEW' },
  });
  requests[2].resolve('NEWER');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).toHaveBeenLastCalledWith('NEWER', 'newer');
  worker.reset();
});
it('認識の訂正にも直前の原文を添え、修正された訳を表示する', async () => {
  const { worker, requests, display } = setup();
  worker.update('予算は100円');
  requests[0].resolve('The budget is 100 yen');
  await vi.advanceTimersByTimeAsync(0);
  worker.update('予算は1000円');
  expect(requests[1].previous).toEqual({
    text: '予算は100円',
    translation: 'The budget is 100 yen',
  });
  requests[1].resolve('The budget is 1,000 yen');
  await vi.advanceTimersByTimeAsync(0);
  expect(display).toHaveBeenLastCalledWith('The budget is 1,000 yen', '予算は1000円');
  worker.reset();
});
