import { expect, test } from '@playwright/test';

const service = 'http://127.0.0.1:4320';

test('Chat streams transient text, rejects interruption, and saves only a completed retry', async ({
  page,
  context,
  request,
}) => {
  const session = await (
    await request.post(`${service}/api/sessions`, { data: { title: 'Streaming chat' } })
  ).json();
  session.status = 'active';
  session.startedAt = new Date().toISOString();
  await request.put(`${service}/api/sessions/${session.id}`, { data: session });
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    if (route.request().url().endsWith('/analyze'))
      await route.fulfill({ status: 503, json: { error: 'test' } });
    else await route.continue({ url: route.request().url().replace(':4319', ':4320') });
  });
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, options) => {
      if (String(input).endsWith('/consult?stream=true')) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ text: '生成途中の回答です' }) + '\n'),
            );
            Object.assign(window, {
              finishChat: (complete: boolean) => {
                if (complete)
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        status: 200,
                        contentType: 'application/json',
                        body: btoa(JSON.stringify({ reply: 'Completed reply' })),
                      }) + '\n',
                    ),
                  );
                controller.close();
              },
            });
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return original(input, options);
    };
  });
  const saved = async () => (await request.get(`${service}/api/sessions/${session.id}`)).json();
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await page.getByRole('textbox', { name: 'AIへの相談' }).fill('質問です');
    await page.getByRole('button', { name: '相談を送信' }).click();
    await expect(page.getByText('生成途中の回答です', { exact: true })).toBeVisible();
    expect((await saved()).chats[0]).toMatchObject({
      status: 'pending',
      reply: '',
      repliedAt: null,
    });
    await page.evaluate(() =>
      (window as unknown as { finishChat: (complete: boolean) => void }).finishChat(false),
    );
    await expect(page.getByRole('button', { name: '再試行', exact: true })).toBeVisible();
    await expect(page.getByText('生成途中の回答です', { exact: true })).toHaveCount(0);
    expect((await saved()).chats[0]).toMatchObject({
      status: 'failed',
      reply: '',
      repliedAt: null,
    });
    await page.getByRole('button', { name: '再試行', exact: true }).click();
    await expect(page.getByText('生成途中の回答です', { exact: true })).toBeVisible();
    expect((await saved()).chats[0].status).toBe('pending');
    await page.evaluate(() =>
      (window as unknown as { finishChat: (complete: boolean) => void }).finishChat(true),
    );
    await expect(page.getByText('Completed reply', { exact: true })).toBeVisible();
    expect((await saved()).chats[0]).toMatchObject({ status: 'applied', reply: 'Completed reply' });
    expect((await saved()).chats[0].repliedAt).toBeTruthy();
    await page.reload();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.getByText('Completed reply', { exact: true })).toBeVisible();
  } finally {
    await request.delete(`${service}/api/sessions/${session.id}`);
  }
});
