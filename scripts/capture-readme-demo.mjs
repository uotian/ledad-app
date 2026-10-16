// Run after `npm run build`. All API responses are fictional and stay in the browser.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';

const { createSession } = await tsImport('../src/lib/session/defaults.ts', import.meta.url);
const { sessionSchema } = await tsImport('../src/lib/session/schema.ts', import.meta.url);
const session = createSession('新サービスの導入ミーティング');
session.status = 'active';
session.settings.language = 'en';
session.settings.translationLanguage = 'ja';
session.startedAt = '2026-10-15T01:00:00.000Z';
const conversation = [
  [
    'Today, let’s discuss the pilot launch of Ledad.',
    '今日は、Ledadの試験導入について話しましょう。',
  ],
  ['We plan to start with two teams next month.', '来月、まず2チームで開始する予定です。'],
  [
    'Our main goal is to reduce the time spent on weekly reports.',
    '主な目標は、週次レポートの作成時間を減らすことです。',
  ],
  [
    'The budget has not been finalized. We will review it next Friday.',
    '予算はまだ確定していません。来週金曜日に確認します。',
  ],
];
session.transcripts = conversation.map(([text, translation], index) => ({
  id: crypto.randomUUID(),
  text,
  translation,
  translationLanguage: 'ja',
  timestamp: new Date(Date.parse(session.startedAt) + index * 15000).toISOString(),
  source: 'mixed',
  analyzed: true,
  disposition: 'open',
  ...(index < 3 ? { correctedAt: session.startedAt } : {}),
}));
session.meetingStartedAt = session.transcripts[0].timestamp;
session.meetingLastAt = session.transcripts.at(-1).timestamp;
session.analyze = {
  glossary: [{ term: 'Ledad', evidenceId: session.transcripts[0].id }],
  topics: [
    {
      id: 'pilot',
      title: '来月から2チームで試験導入',
      summary: '新サービスを小規模に導入し、週次レポート作成の負担を減らします。',
    },
    {
      id: 'budget',
      title: '予算は来週金曜日に確認',
      summary: '費用は未確定です。次回の打ち合わせで予算を確認します。',
    },
  ],
  mentions: [],
  suggestedQuestions: ['決まったことと、まだ決まっていないことは？'],
  suggestedMeetingQuestions: ['試験導入の成果はどのように測定しますか？'],
  updatedAt: session.startedAt,
  language: 'ja',
  profileKey: '{}',
  inputKey: 'demo',
};
session.chats = [
  {
    id: crypto.randomUUID(),
    text: '予算について、次に何を確認すればいい？',
    kind: 'consultation',
    reply:
      '予算はまだ確定していません。次回は次の2点を確認するとよさそうです。\n\n- 試験導入に必要な費用の内訳\n- 本格導入を判断するための評価基準',
    createdAt: session.startedAt,
    repliedAt: session.startedAt,
    status: 'applied',
  },
];
session.candidates = [
  {
    id: crypto.randomUUID(),
    title: '試験導入の評価基準を確認する',
    text: '試験導入の成果は、どのような基準で評価しますか？',
    spokenText: 'How will we measure the success of the pilot?',
    translationLanguage: 'ja',
    caution: '',
    targetId: null,
    createdAt: session.startedAt,
    status: 'ready',
  },
];
sessionSchema.parse(session);

async function makeGif(frames) {
  const width = 1200,
    height = 720;
  const pixels = await Promise.all(
    frames.map((frame) => sharp(frame).resize(width, height).removeAlpha().raw().toBuffer()),
  );
  return sharp(Buffer.concat(pixels), {
    raw: { width, height: height * frames.length, channels: 3, pageHeight: height },
  })
    .gif({ loop: 0, delay: frames.map(() => 2000), colours: 128 })
    .toBuffer();
}
if (process.argv.includes('--check')) {
  const frame = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#201d19' },
  })
    .png()
    .toBuffer();
  const gif = await makeGif([frame, frame]);
  assert.equal((await sharp(gif, { animated: true }).metadata()).format, 'gif');
  console.log('Sample session and GIF encoding checked.');
} else {
  const out = resolve('out');
  await readFile(resolve(out, 'session/index.html'));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 720 },
      locale: 'ja-JP',
      serviceWorkers: 'block',
    });
    await context.addInitScript(() => {
      localStorage.setItem('ledad.language', 'ja');
      localStorage.setItem('ledad.text-size', 'L');
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    // Only local build files and explicit mock APIs can load. No real backend or AI API is used.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.port === '4319') {
        const path = url.pathname;
        if (path === '/api/sessions') return route.fulfill({ json: [] });
        if (path === '/api/config')
          return route.fulfill({ json: { openai: true, gemini: false, aiMode: 'openai' } });
        if (path.endsWith('/cost'))
          return route.fulfill({
            json: {
              pricing: null,
              openai: { yen: 0, incomplete: false },
              gemini: { yen: 0, incomplete: false },
            },
          });
        if (path.endsWith('/usage')) return route.fulfill({ json: [] });
        if (path.endsWith('/analyze') || path.endsWith('/mentions'))
          return route.fulfill({ json: session.analyze });
        if (
          path === `/api/sessions/${session.id}` ||
          path === `/api/sessions/${session.id}/commands`
        )
          return route.fulfill({ json: session });
        if (path === '/api/meeting-settings') return route.fulfill({ json: session.settings });
        return route.fulfill({ status: 400, json: { error: `Unexpected demo API: ${path}` } });
      }
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(out, `.${path}`);
      if (!file.startsWith(`${out}/`)) return route.abort();
      try {
        const contentType =
          {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.woff2': 'font/woff2',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.txt': 'text/plain',
          }[extname(file)] || 'application/octet-stream';
        await route.fulfill({ contentType, body: await readFile(file) });
      } catch {
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-15T01:01:00.000Z'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3107/');
    await page.getByRole('button', { name: '会議を始める', exact: true }).waitFor();
    await page.getByText('AIキー設定済み', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    assert.equal(await page.locator('.app-version').textContent(), `v${version}`);
    const frames = [await page.screenshot({ animations: 'disabled' })];
    // Load the sample meeting directly so the demo never starts real audio capture.
    await page.goto(`http://127.0.0.1:3107/session/?id=${session.id}`);
    await page.getByRole('tab', { name: 'Topics', exact: true }).waitFor();
    await page.getByText(conversation[0][1], { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const tab of ['Topics', 'Chat', 'Ask']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const content = {
        Topics: session.analyze.topics[0].title,
        Chat: session.chats[0].text,
        Ask: session.candidates[0].spokenText,
      }[tab];
      await page.getByText(content, { exact: true }).waitFor();
      frames.push(await page.screenshot({ animations: 'disabled' }));
    }
    await page.getByRole('button', { name: '用語集', exact: true }).click();
    await page.getByRole('dialog', { name: '用語集', exact: true }).waitFor();
    frames.push(await page.screenshot({ animations: 'disabled' }));
    assert.deepEqual(errors, [], 'The demo must render without runtime errors.');
    const output = resolve('docs/assets/ledad-demo.gif');
    const gif = await makeGif(frames);
    const metadata = await sharp(gif, { animated: true }).metadata();
    assert.equal(metadata.pages, frames.length);
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.pageHeight, 720);
    assert.equal(metadata.pages, 5);
    assert.deepEqual(metadata.delay, [2000, 2000, 2000, 2000, 2000]);
    await mkdir(resolve('docs/assets'), { recursive: true });
    await writeFile(output, gif);
    const readme = resolve('README.md');
    let text = await readFile(readme, 'utf8');
    if (!text.includes('docs/assets/ledad-demo.gif')) {
      text = text.replace(
        '# ledad\n',
        '# ledad\n\n![ledad screen demo](docs/assets/ledad-demo.gif)\n\nScreen demo using sample conversation data.\n',
      );
      await writeFile(readme, text);
    }
    console.log(`Created ${output} (${gif.length} bytes).`);
  } finally {
    await browser.close();
  }
}
