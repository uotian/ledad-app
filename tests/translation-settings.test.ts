import { expect, it } from 'vitest';
import { createSession } from '@/lib/session/defaults';
import { settingsSchema } from '@/lib/session/schema';

it('翻訳先を独立して保存でき、旧設定の未指定を読み取れる', () => {
  const legacy: Record<string, unknown> = { ...createSession().settings };
  delete legacy.translationLanguage;
  expect(settingsSchema.parse(legacy).translationLanguage).toBeNull();
  for (const translationLanguage of [null, 'ja', 'en', 'zh', 'fr']) {
    const settings = settingsSchema.parse({ ...legacy, translationLanguage });
    expect(settings.translationLanguage).toBe(translationLanguage);
    expect(settings.language).toBe('ja');
  }
  expect(settingsSchema.safeParse({ ...legacy, translationLanguage: 'invalid' }).success).toBe(
    false,
  );
});
