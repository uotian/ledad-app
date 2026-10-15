import { expect, it } from 'vitest';
import { parseLanguage, translate } from '@/lib/i18n';
import { messages } from '@/lib/i18n/messages';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
it('AIエラーのサービス名を保ち、処理名と理由を翻訳する', () => {
  const error =
    'OpenAI / Fix翻訳：AIサービス側でエラーが発生しました。少し待って再試行してください。';
  expect(translate('ja', error)).toBe(error);
  expect(translate('en', error)).toBe(
    'OpenAI / Translation (Fix): An error occurred on the AI service. Wait a moment and try again.',
  );
  expect(translate('en', 'OpenAI / Analyze：AIの応答待ちがタイムアウトしました。')).toBe(
    'OpenAI / Analyze: Timed out waiting for the AI response.',
  );
  expect(
    translate('zh', 'Gemini / Live音声認識の接続：聞き取りの接続がタイムアウトしました。'),
  ).toBe(
    `Gemini / 语音识别连接（实时）：${translate('zh', '聞き取りの接続がタイムアウトしました。')}`,
  );
});
it('表示言語のフォールバックとパラメータ置換', () => {
  expect(parseLanguage('invalid')).toBe('ja');
  expect(translate('en', '文字サイズ')).toBe('Text size');
  expect(translate('ja', '「{title}」に戻る', { title: '{title}' })).toBe('「{title}」に戻る');
  expect(translate('zh', 'ユーザーが入力した文章')).toBe('ユーザーが入力した文章');
});
it('画面の固定文言に英語・中国語・フランス語の翻訳が揃っている', () => {
  const missing: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (path.endsWith('.tsx')) {
        const source = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        function visit(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === 't' &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          ) {
            const key = node.arguments[0].text;
            if (!messages[key]?.en || !messages[key]?.zh || !messages[key]?.fr)
              missing.push(`${path}: ${key}`);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  scan('src/components');
  expect(missing).toEqual([]);
});

it('フランス語の保存・補間・エラー表示と翻訳変数を保持する', () => {
  expect(parseLanguage('fr')).toBe('fr');
  expect(translate('fr', '「{title}」に戻る', { title: 'Projet' })).toBe('Revenir à « Projet »');
  expect(translate('fr', 'Gemini / Live翻訳：会議が見つかりません。')).toBe(
    'Gemini / Traduction (Live) : Réunion introuvable.',
  );
  for (const [key, value] of Object.entries(messages)) {
    expect(value.fr.trim(), key).not.toBe('');
    expect(value.fr.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(
      value.en.match(/\{\w+\}/g)?.sort() ?? [],
    );
  }
});

it('フランス語の会議と分析結果を保存形式で読み戻せる', async () => {
  const { createSession } = await import('@/lib/session/defaults');
  const { sessionSchema } = await import('@/lib/session/schema');
  const session = createSession();
  session.settings.language = 'fr';
  session.settings.translationLanguage = 'fr';
  session.analyze = {
    topics: [{ id: 'budget', title: 'Budget', summary: 'À confirmer.' }],
    mentions: [],
    suggestedQuestions: [],
    suggestedMeetingQuestions: [],
    updatedAt: session.createdAt,
    language: 'fr',
    profileKey: '{}',
    inputKey: 'test',
  };
  const restored = sessionSchema.parse(JSON.parse(JSON.stringify(session)));
  expect(restored.settings.language).toBe('fr');
  expect(restored.settings.translationLanguage).toBe('fr');
  expect(restored.analyze?.language).toBe('fr');
});
