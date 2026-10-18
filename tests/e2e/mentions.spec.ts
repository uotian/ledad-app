import { createHash } from 'node:crypto';
import { expect, test, type Route } from '@playwright/test';

test('AnalyzeでTopicsとYouを一括更新し、失敗は再試行して古いLive応答を除外する', async ({
  page,
  context,
  request,
}) => {
  const base = 'http://127.0.0.1:4320/api/sessions';
  const session = await (await request.post(base, { data: { title: '言及の更新' } })).json();
  const profile = { name: '内藤芳彦、Yoshi', aliases: '' };
  const text = 'Yoshi、この資料を確認してもらえますか。';
  const id = crypto.randomUUID();
  session.status = 'active';
  session.transcripts = [
    {
      id,
      text,
      translation: '',
      timestamp: new Date().toISOString(),
      source: 'microphone',
      analyzed: false,
      disposition: 'open',
    },
  ];
  session.mentionAnalysis = {
    mentions: [{ kind: 'question', summary: '以前の言及', evidenceId: id, quote: text }],
    mentionSources: {}, updatedAt: new Date().toISOString(), language: 'ja',
    profileKey: JSON.stringify(profile), inputKey: 'legacy',
  };
  await request.put(`${base}/${session.id}`, { data: session });
  await page.addInitScript((profile) => {
    localStorage.setItem('ledad.profile.v1', JSON.stringify(profile));
    localStorage.setItem('ledad.analyzeIntervalSeconds', '0');
  }, profile);
  const calls: Route[] = [];
  let analyzeRequests = 0;
  let separateRequests = 0;
  await context.route('http://127.0.0.1:4319/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/mentions')) {
      separateRequests++;
      await route.fulfill({ status: 500, json: { error: 'Unexpected separate mention request' } });
    } else if (url.endsWith('/analyze')) {
      analyzeRequests++;
      if (analyzeRequests === 1) await route.fulfill({ status: 503, json: { error: 'Analyze unavailable' } });
      else calls.push(route);
    } else if (url.endsWith('/refine-transcripts')) {
      await route.fulfill({
        json: {
          originals: [{ id, text }],
          text,
          translation: '',
          translationLanguage: 'ja',
        },
      });
    } else {
      await route.continue({ url: url.replace(':4319', ':4320') });
    }
  });
  async function respond(route: Route, summary: string) {
    const body = route.request().postDataJSON();
    const profileKey = JSON.stringify(body.profile);
    await route.fulfill({
      json: {
        topics: [{ id: 'topic', title: '資料の確認', summary: '確認を依頼' }],
        suggestedQuestions: [], suggestedMeetingQuestions: [],
        mentions: [{ kind: 'question', summary, evidenceId: id, quote: text }],
        mentionSources: { [id]: 'source-version' },
        updatedAt: new Date().toISOString(),
        language: body.language,
        profileKey,
        inputKey: createHash('sha256')
          .update(
            JSON.stringify({
              version: 19,
              conversation: body.conversation,
              profileKey,
              language: body.language,
              documents: '',
              reservedTerms: [],
            }),
          )
          .digest('hex'),
      },
    });
  }
  try {
    await page.goto(`/session/?id=${session.id}`);
    await page.getByRole('tab', { name: 'You', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    await expect(page.getByText('以前の言及', { exact: true })).toBeVisible();
    expect(calls[0].request().postDataJSON().previous.mentions[0].summary).toBe('以前の言及');
    expect(calls[0].request().postDataJSON().conversation).toEqual([
      expect.objectContaining({ id, text }),
    ]);
    expect(calls[0].request().postDataJSON().conversation[0].settled).toBeUndefined();
    await page.evaluate(
      (id) =>
        window.dispatchEvent(
          new CustomEvent('ledad:test-review', {
            detail: { transcriptIds: [id] },
          }),
        ),
      id,
    );
    await expect(page.locator('[data-recognition="fixed"]')).toHaveCount(1);
    await respond(calls[0], '古いLiveの結果');
    await expect.poll(() => calls.length).toBe(2);
    await expect(page.getByText('古いLiveの結果')).toHaveCount(0);
    const fixed = calls[1].request().postDataJSON();
    expect(fixed.conversation).toEqual([expect.objectContaining({ id, text, settled: true })]);
    expect(fixed.previous.mentionSources).toEqual({});
    await respond(calls[1], '資料の確認を求められています');
    await expect(page.getByText('資料の確認を求められています', { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const saved = await (await request.get(`${base}/${session.id}`)).json();
        return { legacy: saved.mentionAnalysis, topic: saved.analyze?.topics[0]?.title,
                 summary: saved.analyze?.mentions[0]?.summary };
      })
      .toEqual({ legacy: null, topic: '資料の確認', summary: '資料の確認を求められています' });
    await page.reload();
    await page.getByRole('tab', { name: 'You', exact: true }).click();
    await expect(page.getByText('資料の確認を求められています', { exact: true })).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(analyzeRequests).toBe(3);
    expect(separateRequests).toBe(0);
  } finally {
    await page.goto('/');
    await request.delete(`${base}/${session.id}`);
  }
});
