import { afterEach, expect, it, vi } from 'vitest';
import { serviceFetch } from '@/lib/desktop';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class {
    onmessage?: (text: string) => void;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

it('取消通知が失敗しても未処理の拒否を発生させず、遅い応答を取消として返す', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  let finish!: (value: unknown) => void;
  invoke.mockImplementation((command) =>
    command === 'service_cancel'
      ? Promise.reject(new Error('service disconnected'))
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const controller = new AbortController();
  const response = serviceFetch('/api/config', { signal: controller.signal });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  controller.abort();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  finish({ status: 200, contentType: 'application/json', body: 'e30=' });
  await expect(response).rejects.toMatchObject({ name: 'AbortError' });
  expect(invoke.mock.calls[1][0]).toBe('service_cancel');
});

it.each([false, true])(
  'Mac IPC keeps partial output separate from final response (failure=%s)',
  async (failure) => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    invoke.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const partials: string[] = [];
    const result = serviceFetch('/api/sessions/id/consult', { method: 'POST' }, (text) =>
      partials.push(text),
    );
    const outcome = result.then(
      (value) => ({ value }),
      (error: Error) => ({ error }),
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const args = invoke.mock.calls[0][1];
    expect(args.input.stream).toBe(true);
    args.onText.onmessage('途中です');
    expect(partials).toEqual(['途中です']);
    if (failure) {
      fail(new Error('service disconnected'));
      expect(await outcome).toMatchObject({ error: { message: 'service disconnected' } });
    } else {
      finish({
        status: 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ reply: '完成' })).toString('base64'),
      });
      const completed = await outcome;
      expect('value' in completed && (await completed.value.json())).toEqual({ reply: '完成' });
    }
  },
);
