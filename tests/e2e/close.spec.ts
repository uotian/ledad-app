import { test, expect } from '@playwright/test';
import type { ServiceRequest } from '@/lib/desktop';
// ウィンドウイベントとIPCのみを模擬し、保存は実際のローカルサービスへ通します。
// macOSのウィンドウ自体を閉じる操作の代わりにはしません。
test('閉じる直前の入力を保存し、保存失敗時には終了しない', async ({ page, request }) => {
  let failSave = false;
  let quits = 0;
  let savedTitleAtQuit = '';
  let sessionId = '';
  await page.exposeFunction(
    'testInvoke',
    async (command: string, args: { input?: ServiceRequest }) => {
      if (command === 'quit_app') {
        quits++;
        savedTitleAtQuit = (
          await (await request.get(`http://127.0.0.1:4320/api/sessions/${sessionId}`)).json()
        ).title;
        return;
      }
      if (command !== 'service_request' || !args.input) throw new Error('Unexpected command');
      const input = args.input;
      if (failSave && input.method === 'PUT') throw new Error('検証用の保存失敗');
      const response = await request.fetch(`http://127.0.0.1:4320${input.path}`, {
        method: input.method,
        headers: { 'Content-Type': 'application/json' },
        ...(input.body ? { data: input.body } : {}),
      });
      return {
        id: input.id,
        status: response.status(),
        contentType: response.headers()['content-type'],
        body: (await response.body()).toString('base64'),
      };
    },
  );
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => Promise<void>>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let next = 0;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (callback: (event: unknown) => Promise<void>) => {
          callbacks.set(++next, callback);
          return next;
        },
        invoke: async (
          command: string,
          args: { event: string; handler: number; eventId: number },
        ) => {
          if (command === 'plugin:event|listen') {
            listeners.set(args.handler, args);
            return args.handler;
          }
          if (command === 'plugin:event|unlisten') {
            listeners.delete(args.eventId);
            return;
          }
          return (
            window as unknown as {
              testInvoke: (command: string, args: unknown) => Promise<unknown>;
            }
          ).testInvoke(command, args);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (_event: string, id: number) => listeners.delete(id),
      },
      testClose: async () => {
        for (const [id, listener] of listeners) {
          if (listener.event === 'tauri://close-requested')
            await callbacks.get(listener.handler)?.({ event: listener.event, id, payload: null });
        }
      },
    });
  });
  const created = await (
    await request.post('http://127.0.0.1:4320/api/sessions', { data: {} })
  ).json();
  await page.goto(`/session/?id=${created.id}`);
  const title = page.getByLabel('タイトル', { exact: true });
  await expect(title).toBeVisible();
  sessionId = new URL(page.url()).searchParams.get('id')!;
  failSave = true;
  await title.fill('保存に失敗した編集内容');
  await page.evaluate(() => (window as unknown as { testClose: () => Promise<void> }).testClose());
  await expect(
    page.getByRole('alert').filter({ hasText: 'アプリを閉じませんでした' }),
  ).toBeVisible();
  expect(quits).toBe(0);
  failSave = false;
  await title.fill('閉じる直前の編集内容');
  await page.evaluate(() => (window as unknown as { testClose: () => Promise<void> }).testClose());
  expect(quits).toBe(1);
  expect(savedTitleAtQuit).toBe('閉じる直前の編集内容');
});
