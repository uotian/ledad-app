import { expect, test } from '@playwright/test';

const service = 'http://127.0.0.1:4320';
for (const mode of ['audience', 'presenter'] as const) {
  test(`${mode}: 会話を広く表示し、タブ切替で下書き・候補編集を保持する`, async ({
    page,
    context,
    request,
  }) => {
    const session = await (
      await request.post(`${service}/api/sessions`, {
        data: { title: '会話を中心にした会議' },
      })
    ).json();
    session.mode = mode; // Legacy Presenter records open as ordinary meetings.
    session.status = 'active';
    session.settings.language = 'en';
    session.startedAt = new Date().toISOString();
    session.transcripts = [
      {
        id: crypto.randomUUID(),
        text: '導入時期は来月を予定しています。具体的な費用は、次回の打ち合わせで確認します。',
        translation: '',
        timestamp: session.startedAt,
        source: 'display',

        analyzed: true,
        disposition: 'open',
      },
    ];
    session.analyze = {
      topics: [
        {
          id: 'same',
          title: 'AIの先頭論点',
          summary: '先頭の内容',
        },
        {
          id: 'same',
          title: 'AIの次の論点',
          summary: '次の内容',
        },
      ],
      mentions: [
        {
          kind: 'mention',
          summary: 'AIの先頭言及',
          evidenceId: session.transcripts[0].id,
          quote: '引用1',
        },
        { kind: 'mention', summary: 'AIの次の言及', evidenceId: 'unknown', quote: '引用2' },
        {
          kind: 'mention',
          summary: 'AIの末尾言及',
          evidenceId: session.transcripts[0].id,
          quote: '引用3',
        },
      ],
      suggestedQuestions: ['費用の懸念点は？'],
      suggestedMeetingQuestions: ['導入費用はいつ確定しますか？'],
      language: 'ja',
      profileKey: JSON.stringify({ name: '', aliases: '' }),
      inputKey: 'test',
      updatedAt: session.startedAt,
    };
    await request.put(`${service}/api/sessions/${session.id}`, { data: session });
    let generationCount = 0;
    let consultationCount = 0;
    await context.route('http://127.0.0.1:4319/**', async (route) => {
      if (route.request().url().endsWith('/analyze')) {
        await route.fulfill({ status: 503, json: { error: 'Analyze test unavailable' } });
      } else if (route.request().url().endsWith('/generate')) {
        generationCount += 1;
        expect(route.request().postDataJSON().instruction).toBe(
          ['費用が確定する時期を聞きたい', 'もっと短い質問にして', '導入費用はいつ確定しますか？'][
            generationCount - 1
          ],
        );
        await route.fulfill({
          json: {
            note: '',
            candidates: [
              {
                title: '費用を確認する',
                text: '費用はいつ確定しますか？',
                spokenText: 'When will the cost be finalized?',

                caution: '',
              },
            ],
          },
        });
      } else if (route.request().url().endsWith('/consult?stream=true')) {
        consultationCount += 1;
        if (consultationCount === 2) {
          await route.fulfill({ status: 503, json: { error: 'テスト用の一時的な接続失敗' } });
          return;
        }
        await route.fulfill({
          contentType: 'application/x-ndjson',
          body:
            JSON.stringify({
              status: 200,
              contentType: 'application/json',
              body: Buffer.from(
                JSON.stringify({
                  reply:
                    '費用はまだ確定していません。\n\n### 確認できていること\n\n- **導入時期**は来月の予定です。\n- 費用は次回の打ち合わせで確認します。',
                }),
              ).toString('base64'),
            }) + '\n',
        });
      } else {
        await route.continue({ url: route.request().url().replace(':4319', ':4320') });
      }
    });
    try {
      await page.goto(`/session/?id=${session.id}`);
      const candidateTab = page.getByRole('tab', {
        name: 'Ask',
        exact: true,
      });
      const chatTab = page.getByRole('tab', { name: 'Chat', exact: true });
      await expect(page.getByRole('tab', { name: 'Topics', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('tab', { name: 'Topics', exact: true })).toHaveText('Topics');
      await expect(
        page.getByRole('tabpanel', { name: 'Topics', exact: true }).locator('article h3'),
      ).toHaveText(['01AIの先頭論点', '02AIの次の論点']);
      const updated = page.locator('.assistant-updated-at');
      await expect(updated).toHaveText(/最終更新 \d+秒前/);
      await expect(updated).toHaveCSS('text-align', 'right');
      await expect(updated.locator('time')).toHaveAttribute('datetime', session.analyze.updatedAt);
      await expect(chatTab).toHaveText('Chat');
      await expect(page.getByText(/次の確認まで \d+秒/)).toHaveCount(0);
      await expect(page.locator('[data-recognition="live"]')).toBeVisible();
      await expect(page.getByText('Flush(Transcribed)', { exact: true })).toHaveCount(0);
      await chatTab.click();
      await expect(updated).toHaveCount(0);
      await expect(page.locator('.assistant-welcome')).toHaveCount(0);
      await expect(
        page.getByText('会議について聞きたいことを、下の欄に入力してください。'),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '費用の懸念点は？', exact: true }),
      ).toBeVisible();
      const draft = page.getByLabel('AIへの相談');
      const chatComposer = (await page.locator('.chat-panel .chat-composer').boundingBox())!;
      await draft.fill('費用が確定する時期を確認したい');
      await candidateTab.click();
      await expect(page.getByText('伝えたいことを、下の欄に入力してください。')).toBeVisible();
      const askInput = page.getByRole('textbox', { name: 'Askへの依頼' });
      const askComposer = page.locator('.candidate-panel .chat-composer');
      await expect
        .poll(async () => (await askComposer.boundingBox())?.height)
        .toBe(chatComposer.height);
      expect((await askComposer.boundingBox())!.y).toBe(chatComposer.y);
      await askInput.fill('聞きたいこと\n補足の説明\n追加の条件');
      await expect
        .poll(async () => (await askComposer.boundingBox())!.height)
        .toBeGreaterThan(chatComposer.height);
      await chatTab.click();
      await candidateTab.click();
      await expect(askInput).toHaveValue('聞きたいこと\n補足の説明\n追加の条件');
      await askInput.fill('');
      await expect
        .poll(async () => (await askComposer.boundingBox())?.height)
        .toBe(chatComposer.height);
      await expect(
        page.getByRole('button', { name: '導入費用はいつ確定しますか？', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '費用の懸念点は？', exact: true }),
      ).toBeHidden();
      await expect(draft).not.toBeVisible();
      // キーボードでもタブを移動でき、下書きが維持されます。
      await candidateTab.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Topics', exact: true })).toBeFocused();
      await page.getByRole('tab', { name: 'Topics', exact: true }).press('ArrowRight');
      const forYouTab = page.getByRole('tab', { name: 'You', exact: true });
      await expect(forYouTab).toBeFocused();
      await expect(page.getByRole('tabpanel', { name: 'You', exact: true })).toBeVisible();
      await expect(page.getByRole('tabpanel', { name: 'Topics', exact: true })).toBeHidden();
      await expect(
        page.getByRole('tabpanel', { name: 'You', exact: true }).locator('article > p'),
      ).toHaveText(['AIの先頭言及', 'AIの次の言及', 'AIの末尾言及']);
      await forYouTab.press('ArrowRight');
      await expect(chatTab).toBeFocused();
      await expect(draft).toHaveValue('費用が確定する時期を確認したい');
      await page.getByRole('button', { name: '相談を送信' }).click();
      await expect(chatTab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.chat-reply')).toContainText('費用はまだ確定していません');
      await expect(page.locator('.chat-reply .chat-message-meta > span')).toHaveText('AI');
      await expect(page.locator('.chat-reply-content h3')).toHaveText('確認できていること');
      await expect(page.locator('.chat-reply-content li')).toHaveCount(2);
      await expect(page.locator('.chat-reply-content strong')).toHaveText('導入時期');
      expect(generationCount).toBe(0);
      await draft.fill('相談の続き');
      await page.getByRole('button', { name: '相談を送信' }).click();
      await page.getByRole('button', { name: '再試行', exact: true }).click();
      await expect(page.locator('.chat-reply-content')).toHaveCount(2);
      await expect(chatTab).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(
          async () =>
            (
              await (await request.get(`${service}/api/sessions/${session.id}`)).json()
            ).chats.filter((chat: { status: string }) => chat.status === 'applied').length,
        )
        .toBe(2);
      await page.getByRole('button', { name: '費用の懸念点は？', exact: true }).click();
      await expect(page.locator('.chat-reply-content')).toHaveCount(3);
      await candidateTab.click();
      await expect(page.getByRole('button', { name: '発言案を作る', exact: true })).toBeDisabled();
      await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('Askの下書き');
      await chatTab.click();
      await candidateTab.click();
      await expect(page.getByRole('textbox', { name: 'Askへの依頼' })).toHaveValue('Askの下書き');
      await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('費用が確定する時期を聞きたい');
      await page.getByRole('button', { name: '発言案を作る', exact: true }).click();
      await expect(page.locator('.candidate-card')).toBeVisible();
      await page.getByRole('button', { name: '発話する文章を編集する' }).click();
      await expect(page.getByLabel('発話する文章', { exact: true })).toBeFocused();
      await page
        .getByLabel('発話する文章', { exact: true })
        .fill('When will the cost be confirmed?');
      await chatTab.click();
      await draft.fill('次の相談の下書き');
      await candidateTab.click();
      await expect(page.getByLabel('発話する文章', { exact: true })).toHaveValue(
        'When will the cost be confirmed?',
      );
      await page
        .locator('.candidate-card')
        .getByRole('button', { name: '完了', exact: true })
        .click();
      await expect(page.locator('.candidate-speech')).toHaveText(
        'When will the cost be confirmed?',
      );
      await expect(page.getByLabel('発話する文章', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '候補1を読み上げる', exact: true }),
      ).toBeEnabled();
      await expect(candidateTab).toHaveText('Ask');
      const saved = await (await request.get(`${service}/api/sessions/${session.id}`)).json();
      expect(saved.utterances).toHaveLength(0);
      await expect(page.locator('.transcript-item button')).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('もっと短い質問にして');
      await page.getByRole('button', { name: '発言案を作る', exact: true }).click();
      await expect(page.locator('.candidate-card')).toBeVisible();
      await chatTab.click();
      await expect(draft).toHaveValue('次の相談の下書き');
      await candidateTab.click();
      await page.getByRole('textbox', { name: 'Askへの依頼' }).fill('残しておく下書き');
      const consultationsBeforeSuggestion = consultationCount;
      await page.getByRole('button', { name: '導入費用はいつ確定しますか？', exact: true }).click();
      await expect.poll(() => generationCount).toBe(3);
      await expect(page.locator('.ask-request')).toHaveText('導入費用はいつ確定しますか？');
      await expect(page.getByRole('textbox', { name: 'Askへの依頼' })).toHaveValue(
        '残しておく下書き',
      );
      expect(consultationCount).toBe(consultationsBeforeSuggestion);
      const afterSuggestion = await (
        await request.get(`${service}/api/sessions/${session.id}`)
      ).json();
      expect(afterSuggestion.utterances).toHaveLength(0);
      expect(afterSuggestion.analyze.suggestedMeetingQuestions).toEqual([
        '導入費用はいつ確定しますか？',
      ]);
      for (const width of [1440, 980]) {
        await page.setViewportSize({ width, height: 960 });
        const conversation = (await page.locator('.meeting-left').boundingBox())!;
        const assistant = (await page.locator('.assistant-panel').boundingBox())!;
        expect(conversation.width / (conversation.width + assistant.width)).toBeGreaterThan(0.55);
        expect(assistant.x + assistant.width).toBeLessThanOrEqual(width);
        expect(assistant.y).toBe(conversation.y);
        await page.screenshot({
          animations: 'disabled',
          path: `artifacts/meeting-tabs-${mode}-${width}.png`,
        });
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await chatTab.click();
      await page.screenshot({
        animations: 'disabled',
        path: `artifacts/meeting-tabs-${mode}-chat.png`,
      });
      await page.locator('html').evaluate((element) => {
        element.dataset.theme = 'dark';
      });
      await page.screenshot({
        animations: 'disabled',
        path: `artifacts/meeting-tabs-${mode}-dark-chat.png`,
      });
      await page.setViewportSize({ width: 980, height: 760 });
      const reply = page.locator('.chat-reply-content').first();
      expect(await reply.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.locator('.assistant-panel').screenshot({
        animations: 'disabled',
        path: `artifacts/meeting-tabs-${mode}-compact-chat.png`,
      });
      await page.setViewportSize({ width: 1440, height: 960 });
      await candidateTab.click();
      await page.screenshot({
        animations: 'disabled',
        path: `artifacts/meeting-tabs-${mode}-dark.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.locator('body').evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await page.locator('.assistant-panel').screenshot({
        animations: 'disabled',
        path: `artifacts/meeting-tabs-${mode}-mobile-ask.png`,
      });
      await page.getByRole('link', { name: 'ledad ホーム' }).click();
      await expect(page).toHaveURL('/');
    } finally {
      await request.delete(`${service}/api/sessions/${session.id}`);
    }
  });
}
