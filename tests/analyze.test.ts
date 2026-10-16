import { expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { sessionSchema } from '@/lib/session/schema';
import { documentsFor } from '@/lib/session/policy';
import { analyzeKey, mentionTimestamp, conversationForAnalyze } from '@/lib/session/analyze';

const conversation = [
  {
    id: crypto.randomUUID(),
    text: '導入は来月に決まりました。',
    timestamp: '2026-10-05T00:00:00Z',
  },
  {
    id: crypto.randomUUID(),
    text: '内藤さん、費用を金曜までに確認してください。',
    timestamp: '2026-10-05T00:01:00Z',
  },
];

const profile = { name: '内藤', aliases: 'Naito、Yoshihiko' };

it('全会話を時刻順に渡し、古い発言の訂正も入力キーに反映する', async () => {
  const session = createSession();
  session.transcripts = [
    {
      ...conversation[1],
      timestamp: '2026-10-05T01:00:00Z',
      translation: '',
      source: 'display',
      analyzed: false,
      disposition: 'open',
    },
    {
      ...conversation[0],
      translation: '',
      source: 'display',
      analyzed: false,
      disposition: 'open',
    },
  ];
  session.utterances = [
    {
      id: crypto.randomUUID(),
      kind: 'question',
      candidateId: null,
      targetId: null,
      page: null,
      plannedText: '再生済み。未再生。',
      completedText: '再生済み。',
      status: 'interrupted',
      startedAt: '2026-10-05T00:30:00Z',
      endedAt: null,
      elapsedSeconds: 1,
    },
  ];
  const entries = conversationForAnalyze(session);
  expect(entries.map((entry) => entry.text)).toEqual([
    conversation[0].text,
    '再生済み。',
    conversation[1].text,
  ]);
  const key = await analyzeKey(entries, '{}', 'ja');
  session.transcripts[1].text = '導入時期は未定に訂正。';
  expect(await analyzeKey(conversationForAnalyze(session), '{}', 'ja')).not.toBe(key);
});

it('言及の時刻はFix統合後も元の発言IDから引き、参照不明なら推測しない', () => {
  const session = createSession();
  session.transcripts = [
    {
      id: conversation[0].id,
      text: '統合された発言',
      translation: '',
      timestamp: conversation[0].timestamp,
      source: 'display',

      analyzed: true,
      disposition: 'open',
      liveSegments: conversation.map((part) => ({ ...part, disposition: 'open' })),
    },
  ];
  expect(mentionTimestamp(session, conversation[0].id)).toBe(conversation[0].timestamp);
  expect(mentionTimestamp(session, conversation[1].id)).toBe(conversation[1].timestamp);
  expect(mentionTimestamp(session, 'unknown')).toBeNull();
  session.transcripts[0].liveSegments = undefined;
  expect(mentionTimestamp(session, conversation[0].id)).toBe(conversation[0].timestamp);
});

const result = () => ({
  glossary: [],
  suggestedQuestions: ['導入前の確認点は？'],
  suggestedMeetingQuestions: ['費用はいつ確定しますか？'],
  topics: [
    {
      id: conversation[0].id,
      title: '導入時期',
      summary: '来月の導入に合意。',
    },
  ],
  mentions: [
    {
      kind: 'request' as const,
      summary: '金曜までに費用を確認する依頼。',
      evidenceId: conversation[1].id,
      quote: conversation[1].text,
    },
  ],
});

it('会話・言語・名前が変わった場合だけ再解析するためのキーを変える', async () => {
  const key = await analyzeKey(conversation, JSON.stringify(profile), 'ja');
  expect(await analyzeKey(structuredClone(conversation), JSON.stringify(profile), 'ja')).toBe(key);
  expect(await analyzeKey(conversation, JSON.stringify(profile), 'en')).not.toBe(key);
  expect(await analyzeKey(conversation, '{}', 'ja')).not.toBe(key);
  expect(await analyzeKey([conversation[0]], JSON.stringify(profile), 'ja')).not.toBe(key);
  expect(
    await analyzeKey(
      conversation.map((item, index) =>
        index === 0 ? { ...item, text: '導入は再来月に訂正されました。' } : item,
      ),
      JSON.stringify(profile),
      'ja',
    ),
  ).not.toBe(key);
});

it('旧会議の確認済み状態は読み捨て、Analyzeは保持して共有画面には出さない', () => {
  const original = createSession();
  const legacy = { ...original, analyze: undefined };
  expect(sessionSchema.parse(legacy)).toMatchObject({ analyze: null });
  const session = sessionSchema.parse({
    ...original,
    analyze: {
      ...result(),
      updatedAt: original.createdAt,
      language: 'ja',
      profileKey: JSON.stringify(profile),
      inputKey: 'abc',
    },
    analyzeSeenIds: [`${conversation[1].id}:request`],
  });
  expect(session.analyze?.topics).toHaveLength(1);
  expect(session).not.toHaveProperty('analyzeSeenIds');
});

it('Analyze用に選択した資料の内容が変われば入力キーを変える', async () => {
  const documents = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: '背景.md',
      kind: 'reference' as const,
      format: 'text' as const,
      size: 10,
      pages: [{ number: 1, text: '事前情報' }],
      preparationPending: false,
    },
  ];
  const session = {
    ...createSession(),
    documents,
    documentReference: { documentIds: [documents[0].id], summary: '参照文', glossary: [] },
  };
  const key = () => analyzeKey(conversation, '{}', 'ja', documentsFor(session));
  const first = await key();
  session.documentReference.summary += '追記';
  const changed = await key();
  expect(changed).not.toBe(first);
  documents[0].name += '改名';
  documents[0].pages[0].text += '原文訂正';
  expect(await key()).toBe(changed);
  session.documentReference.summary = '';
  expect(await key()).not.toBe(changed);
});

it('質問候補のない旧Analyzeも読める', () => {
  const session = createSession();
  session.analyze = {
    ...result(),
    updatedAt: session.createdAt,
    language: 'ja',
    profileKey: '{}',
    inputKey: 'old',
  };
  const restored = sessionSchema.parse({
    ...session,
    analyze: {
      ...session.analyze,
      suggestedQuestions: undefined,
      suggestedMeetingQuestions: undefined,
    },
  });
  expect(restored.analyze?.suggestedQuestions).toEqual([]);
  expect(restored.analyze?.suggestedMeetingQuestions).toEqual([]);
});

it('旧insightsを会話分析として読み込み、新しい保存項目を優先する', () => {
  const legacy: Record<string, unknown> = { ...createSession() };
  delete legacy.analyze;
  const result = {
    topics: [
      {
        id: 'topic',
        title: '導入',
        summary: '来月の予定',
        evidenceIds: [],
        decisions: ['旧決定'],
        openQuestions: ['旧未決事項'],
      },
    ],
    mentions: [],
    updatedAt: new Date().toISOString(),
    language: 'ja',
    profileKey: '{}',
    inputKey: 'legacy',
  };
  legacy.insights = result;
  expect(sessionSchema.parse(legacy).analyze?.inputKey).toBe('legacy');
  expect(sessionSchema.parse(legacy).analyze?.topics[0]).toEqual({
    id: 'topic',
    title: '導入',
    summary: '来月の予定',
  });
  expect(sessionSchema.parse({ ...legacy, analyze: null }).analyze).toBeNull();
  expect(sessionSchema.parse(legacy)).not.toHaveProperty('insights');
});

it('Liveは原文として残し、Fix区間の最後の発言時刻と確定状態を渡す', () => {
  const session = createSession();
  const fixedId = crypto.randomUUID();
  session.transcripts = [
    {
      id: fixedId,
      text: '統合した原文',
      translation: '',
      source: 'mixed',
      timestamp: '2026-10-14T10:00:00Z',
      analyzed: false,
      disposition: 'open',
      correctedAt: '2026-10-14T10:01:30Z',
      liveSegments: [
        { id: fixedId, text: '前半', timestamp: '2026-10-14T10:00:00Z', disposition: 'open' },
        {
          id: crypto.randomUUID(),
          text: '後半',
          timestamp: '2026-10-14T10:00:45Z',
          disposition: 'open',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      text: '最新のLive',
      translation: '',
      source: 'mixed',
      timestamp: '2026-10-14T10:01:00Z',
      analyzed: false,
      disposition: 'open',
    },
  ];
  const entries = conversationForAnalyze(session);
  expect(entries[0]).toMatchObject({ settled: true, endTimestamp: '2026-10-14T10:00:45Z' });
  expect(entries[1]).not.toHaveProperty('settled');
  expect(entries[0].timestamp).toBe('2026-10-14T10:00:00Z');
});

it('引き継ぎ要約・分析開始時刻・過去の話題の根拠IDを保存後も保持する', () => {
  const session = createSession();
  session.analyze = {
    ...result(),
    language: 'ja',
    profileKey: '{}',
    inputKey: 'key',
    startedAt: '2026-10-14T10:00:00Z',
    updatedAt: '2026-10-14T10:00:10Z',
    context: { summary: '経緯と未解決点', coveredCount: 5, sourceKey: 'hash' },
    topicEvidence: { [conversation[0].id]: conversation[0].id },
    mentionSources: { [conversation[0].id]: 'source-hash' },
  };
  expect(sessionSchema.parse(JSON.parse(JSON.stringify(session))).analyze).toEqual(session.analyze);
});

it('確保済み用語の変更で入力キーを更新し、選別結果だけでは更新しない', async () => {
  const key = await analyzeKey(conversation, '{}', 'ja', '同じ要約', ['Owner', 'Ledad']);
  expect(await analyzeKey(conversation, '{}', 'ja', '同じ要約', ['Owner', 'NewTerm'])).not.toBe(key);
  expect(await analyzeKey(conversation, '{}', 'ja', '同じ要約', ['Owner', 'Ledad'])).toBe(key);
});
