import { expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { analyzeSchema } from '@/lib/session/analyze';
import { glossaryEntries } from '@/lib/session/glossary';

it('名前・資料・確定した会話の優先順で出典を一つにし、削除・訂正・未Fixを除外する', () => {
  const session = createSession();
  const id = crypto.randomUUID();
  session.documents = [
    {
      id,
      name: '資料',
      format: 'text',
      kind: 'reference',
      pages: [],
      size: 0,
      preparationPending: false,
    },
  ];
  session.documentReference = {
    documentIds: [id],
    summary: '',
    glossary: ['Ledad', 'Sakana AI', 'bad<term', 'a'.repeat(51)],
  };
  session.transcripts = [
    {
      id,
      text: '内藤芳彦とLedadとSakana AIとOpenSearchの話',
      timestamp: session.createdAt,
      source: 'display',
      translation: '',
      analyzed: true,
      disposition: 'open',
      correctedAt: session.createdAt,
    },
  ];
  session.analyze = analyzeSchema.parse({
    topics: [],
    mentions: [],
    updatedAt: session.createdAt,
    language: 'ja',
    profileKey: '{}',
    inputKey: '',
    glossary: ['内藤芳彦', 'Ledad', 'Sakana AI', 'OpenSearch'].map((term) => ({
      term,
      evidenceId: id,
    })),
  });
  const profile = { name: '内藤芳彦 Ledad ledad', aliases: '' as const };
  expect(glossaryEntries(session, profile)).toEqual([
    { term: '内藤芳彦', source: 'profile' },
    { term: 'Ledad', source: 'profile' },
    { term: 'Sakana AI', source: 'document' },
    { term: 'OpenSearch', source: 'analyze' },
  ]);
  session.documents = [];
  session.transcripts[0].text = 'Ledadの話';
  expect(glossaryEntries(session, profile)).toHaveLength(2);
  delete session.transcripts[0].correctedAt;
  expect(glossaryEntries(session, { name: '', aliases: '' })).toEqual([]);
});

it('出典を含め100語までとし、用語集のない旧Analyzeは空として読める', () => {
  const session = createSession();
  expect(
    glossaryEntries(session, {
      name: Array.from({ length: 110 }, (_, i) => `term${i}`).join(' '),
      aliases: '',
    }),
  ).toHaveLength(100);
  expect(
    analyzeSchema.parse({
      topics: [],
      mentions: [],
      updatedAt: session.createdAt,
      language: 'ja',
      profileKey: '{}',
      inputKey: '',
    }).glossary,
  ).toEqual([]);
});
