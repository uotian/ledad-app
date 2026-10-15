import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createSession } from '../src/lib/session/defaults';
import { pythonService } from './python-service';
import type { Candidate } from '../src/lib/session/schema';
import { wavDuration } from '../src/lib/audio/wav';
// 実APIを使います。入力は検証用の架空データで、通常の会議とは保存先を分けます。
async function main() {
  const service = pythonService('.data/language-check');
  try {
    await mkdir('artifacts', { recursive: true });
    const results = [];
    for (const language of ['en', 'zh', 'fr'] as const) {
      const session = createSession(`言語検証 ${language}`);
      session.status = 'active';
      session.settings.language = language;
      session.documents = [
        {
          id: crypto.randomUUID(),
          name: '非公開の検証メモ',
          kind: 'reference',
          preparationPending: false,
          format: 'text',
          size: 100,
          pages: [
            {
              number: 1,
              text: 'PRIVATE_LANGUAGE_42。担当者への個人的な不満。秘密の費用は99万円。会議では公表しない。',
            },
          ],
        },
      ];
      const text = {
        en: 'How much will the pilot project cost?',
        zh: '试点项目需要多少费用？',
        fr: 'Combien coûtera le projet pilote ?',
      }[language];
      // Create through the service so all writes use the Python repository.
      const created = await service.json<{ id: string; shareToken: string }>(
        '/api/sessions',
        'POST',
        { title: session.title },
      );
      session.id = created.id;
      session.shareToken = created.shareToken;
      await service.json(`/api/sessions/${session.id}`, 'PUT', session);
      const translated = await service.json<{ translation: string }>(
        `/api/sessions/${session.id}/translate`,
        'POST',
        { text, translationLanguage: 'ja' },
      );
      session.transcripts = [
        {
          id: crypto.randomUUID(),
          text,
          translation: translated.translation,
          timestamp: new Date().toISOString(),
          source: 'manual',

          analyzed: true,
          disposition: 'open',
        },
      ];
      await service.json(`/api/sessions/${session.id}`, 'PUT', session);
      const result = await service.json<{ candidates: Candidate[] }>(
        `/api/sessions/${session.id}/generate`,
        'POST',
        { targetId: session.transcripts[0].id },
      );
      assert.ok(result.candidates.length >= 1);
      assert.ok(
        result.candidates.every((c) => /[ぁ-んァ-ン]/.test(c.text)),
        '本人向けの確認文は日本語',
      );
      assert.ok(!JSON.stringify(result).includes('PRIVATE_LANGUAGE_42'));
      assert.ok(!JSON.stringify(result).includes('99'));
      const speech = await service.request('/api/speech', 'POST', {
        sessionId: session.id,
        text: result.candidates[0].spokenText,
        language,
        voice: 'Kore',
      });
      const audio = { bytes: Buffer.from(await speech.arrayBuffer()) };
      assert.ok((wavDuration(audio.bytes) || 0) > 0);
      await writeFile(`artifacts/language-${language}.wav`, audio.bytes);
      results.push({
        language,
        sessionId: session.id,
        translation: translated,
        candidate: result.candidates[0],
        audioSeconds: wavDuration(audio.bytes),
      });
      console.log(`${language}: 質問解析・非公開背景処理・候補・音声生成が成功`);
    }
    await writeFile('artifacts/language-check.json', JSON.stringify(results, null, 2));
  } finally {
    await service.close();
  }
}
main().catch((error) => {
  console.error('言語検証失敗', error.name, error.status || '');
  process.exitCode = 1;
});
