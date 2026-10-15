import { expect, it } from 'vitest';
import { visibleMentions, type Analyze } from '@/lib/session/analyze';
import { createSession } from '@/lib/session/defaults';

function fixture() {
  const session = createSession();
  const mentions: Analyze['mentions'] = [
    {
      evidenceId: crypto.randomUUID(),
      kind: 'request',
      summary: '内藤さんへの資料確認の依頼',
      quote: '内藤さん、明日までに資料を確認してください。',
    },
    {
      evidenceId: crypto.randomUUID(),
      kind: 'request',
      summary: '内藤さんへの資料確認の依頼',
      quote: '内藤さん 明日までに資料を確認してください',
    },
  ];
  session.transcripts = mentions.map((mention, index) => ({
    id: mention.evidenceId,
    text: mention.quote,
    translation: '',
    timestamp: `2026-10-15T00:00:${index ? '16' : '00'}Z`,
    source: 'mixed',
    disposition: 'open',
    analyzed: true,
    ...(index ? { correctedAt: '2026-10-15T00:00:30Z' } : {}),
  }));
  return { session, mentions };
}

it('近接したLiveとFixの引用の表記差をまとめ、保存内容は変更しない', () => {
  const { session, mentions } = fixture();
  const before = JSON.stringify({ session, mentions });
  expect(visibleMentions(session, mentions)).toHaveLength(1);
  expect(JSON.stringify({ session, mentions })).toBe(before);
  // 次の訂正で先の抽出が消えても、残した元データから後の言及を表示できる。
  expect(visibleMentions(session, mentions.slice(1))[0].evidenceId).toBe(mentions[1].evidenceId);
});

it('別のFix区間にある前置きだけ違う引用も、同じ要点ならまとめる', () => {
  const { session, mentions } = fixture();
  mentions[0].quote = 'もうこれこれ派遣隊にお任せあれですよ。';
  mentions[1].quote = 'これこれ派遣隊にお任せあれですよ';
  mentions.forEach((mention) => {
    mention.summary = '派遣隊に任せる案';
  });
  session.transcripts.forEach((transcript) => {
    transcript.correctedAt = '2026-10-15T00:01:00Z';
  });
  expect(visibleMentions(session, mentions)).toHaveLength(1);
});

it.each(['later', 'kind', 'number', 'negation', 'short', 'unknown', 'invalid'] as const)(
  '%sは同じ言及と決めつけて消さない',
  (change) => {
    const { session, mentions } = fixture();
    if (change === 'later') session.transcripts[1].timestamp = '2026-10-15T00:01:00Z';
    if (change === 'kind') mentions[1].kind = 'question';
    if (change === 'number') {
      mentions[0].quote = '内藤さんの費用は1.2万円を予定しています';
      mentions[1].quote = '内藤さんの費用は12万円を予定しています';
    }
    if (change === 'negation') {
      mentions[1].quote = `${mentions[0].quote}とは言っていません。`;
      mentions[1].summary = '資料の確認を依頼したことを否定';
    }
    if (change === 'short')
      mentions.forEach((mention) => {
        mention.quote = '内藤さん';
      });
    if (change === 'unknown') session.transcripts = [];
    if (change === 'invalid') session.transcripts[1].timestamp = 'invalid';
    expect(visibleMentions(session, mentions)).toHaveLength(2);
  },
);
