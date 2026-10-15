import { describe, expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { exportMarkdown } from '@/lib/session/markdown';
import { documentReferenceSchema, documentSchema, type Document } from '@/lib/session/schema';
import { documentsFor, documentsPending } from '@/lib/session/policy';
const doc = (overrides: Partial<Document> = {}): Document => ({
  id: crypto.randomUUID(),
  name: '非公開背景',
  kind: 'reference',
  preparationPending: false,
  format: 'text',
  pages: [{ number: 1, text: '原文SECRET-7842' }],
  size: 100,
  ...overrides,
});
it('旧個別結果を読み捨て、原本を保持して共通結果の生成対象にする', () => {
  const original = doc();
  const restored = documentSchema.parse({
    ...original,
    markdown: '旧要約',
    glossary: [{ term: '旧語' }],
  });
  expect(restored).not.toHaveProperty('markdown');
  expect(restored).not.toHaveProperty('glossary');
  expect(restored.pages).toEqual(original.pages);
  const session = { ...createSession(), documents: [restored] };
  expect(documentsFor(session)).toBe('');
  expect(documentsPending(session)).toBe(true);
});
it('要約だけを渡し、原文・ファイル情報を含めず、削除後は無効にする', () => {
  const session = createSession();
  const first = doc(),
    second = doc();
  session.documents = [first, second];
  session.documentReference = {
    documentIds: [first.id, second.id],
    summary: '会議共通の要点',
    glossary: [],
  };
  expect(documentsFor(session)).toBe('会議共通の要点');
  session.documents = [first];
  expect(documentsFor(session)).toBe('');
});
it('資料追加の生成待ちは前の要約を使う', () => {
  const session = createSession(),
    old = doc();
  session.documents = [old, doc({ preparationPending: true })];
  session.documentReference = { documentIds: [old.id], summary: '前の参照文', glossary: [] };
  expect(documentsFor(session)).toBe('前の参照文');
});
describe('会議記録', () => {
  it('中断した全文・私的指示・候補・資料を議事録の入力に含めない', () => {
    const session = createSession();
    session.documents = [doc()];
    session.chats = [
      {
        id: crypto.randomUUID(),
        text: '非公開CHAT',
        createdAt: session.createdAt,
        status: 'applied',
        kind: 'instruction',
        reply: '',
      },
    ];
    session.utterances = [
      {
        id: crypto.randomUUID(),
        kind: 'question',
        candidateId: null,
        targetId: null,
        page: null,
        plannedText: '完了した区間。まだ話していない秘密。',
        completedText: '完了した区間。',
        status: 'interrupted',
        startedAt: session.createdAt,
        endedAt: session.createdAt,
        elapsedSeconds: 4,
      },
    ];
    const markdown = exportMarkdown(session);
    expect(markdown).toContain('中断');
    expect(markdown).not.toContain('まだ話していない');
    expect(markdown).not.toContain('非公開CHAT');
  });
});

it('旧用語オブジェクトを文字列配列へ変換して保存する', () => {
  const reference = documentReferenceSchema.parse({
    documentIds: [],
    summary: '',
    glossary: [{ term: 'Ledad', reading: 'レダッド', meaning: '説明' }, 'Gemini'],
  });
  expect(reference.glossary).toEqual(['Ledad', 'Gemini']);
  expect(documentReferenceSchema.parse(reference)).toEqual(reference);
});

it('保存済みの資料要約をsummaryへ引き継ぐ', () => {
  const old = { documentIds: [], markdown: '保存済みの要約', glossary: [] };
  expect(documentReferenceSchema.parse(old)).toEqual({
    documentIds: [],
    summary: '保存済みの要約',
    glossary: [],
  });
  expect(documentReferenceSchema.parse({ ...old, summary: '新しい要約' }).summary).toBe(
    '新しい要約',
  );
});
