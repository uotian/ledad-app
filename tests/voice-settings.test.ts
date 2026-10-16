import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readVoice, rememberedVoice, saveVoice } from '../src/components/settings/voice';
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('モードの既定値と各モード・プロバイダーの声を保持する', () => {
  expect(readVoice('openai')).toBe('marin');
  expect(readVoice('gemini')).toBe('Kore');
  saveVoice('cedar', 'openai');
  saveVoice('Aoede', 'gemini');
  expect(readVoice('openai')).toBe('cedar');
  expect(readVoice('gemini')).toBe('Aoede');
  saveVoice(rememberedVoice('openai'), 'gemini');
  expect(readVoice('gemini')).toBe('cedar');
  expect(rememberedVoice('gemini')).toBe('Aoede');
  expect(() => saveVoice('Kore', 'openai')).toThrow();
  expect(readVoice('openai')).toBe('cedar');
});
it('旧設定を残して読み継ぎ、OpenAIのみではGeminiの声を使わない', () => {
  values.set('ledad.voice', 'Charon');
  expect(readVoice('gemini')).toBe('Charon');
  expect(readVoice('openai')).toBe('marin');
  saveVoice('cedar', 'gemini');
  expect(values.get('ledad.voice')).toBe('Charon');
});
it('破損した設定や保存失敗を既定値で隠さない', () => {
  values.set('ledad.voices', '{');
  expect(() => readVoice('gemini')).toThrow();
  expect(() => saveVoice('cedar', 'openai')).toThrow();
  expect(values.get('ledad.voices')).toBe('{');
});
