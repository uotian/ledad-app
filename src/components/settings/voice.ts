import { z } from 'zod';
import { settingsSchema } from '@/lib/session/schema';
import type { Settings } from '@/lib/session/schema';

export type AIMode = 'openai' | 'gemini';
const voiceStorageKey = 'ledad.voice';
const preferencesKey = 'ledad.voices';
const voiceSchema = settingsSchema.shape.voice;
const preferencesSchema = z
  .object({
    modes: z.object({ openai: voiceSchema.optional(), gemini: voiceSchema.optional() }),
    voices: z.object({ openai: voiceSchema.optional(), gemini: voiceSchema.optional() }),
  })
  .superRefine((value, ctx) => {
    if (
      (value.modes.openai && voiceProvider(value.modes.openai) !== 'openai') ||
      Object.entries(value.voices).some(([provider, voice]) => voiceProvider(voice) !== provider)
    ) {
      ctx.addIssue({ code: 'custom', message: '声の設定を読み込めません。' });
    }
  });
export function voiceProvider(voice: Settings['voice']): AIMode {
  return voice === 'marin' || voice === 'cedar' ? 'openai' : 'gemini';
}
function preferences() {
  const raw = localStorage.getItem(preferencesKey);
  return raw
    ? preferencesSchema.parse(JSON.parse(raw))
    : ({ modes: {}, voices: {} } as z.infer<typeof preferencesSchema>);
}
export function readVoice(mode?: AIMode): Settings['voice'] | null {
  const legacy = () => {
    const parsed = voiceSchema.safeParse(localStorage.getItem(voiceStorageKey));
    return parsed.success ? parsed.data : null;
  };
  if (!mode) {
    try {
      return legacy();
    } catch {
      return null;
    }
  }
  const saved = preferences().modes[mode];
  const old = legacy();
  return (
    saved ??
    (old && (mode === 'gemini' || voiceProvider(old) === 'openai')
      ? old
      : mode === 'openai'
        ? 'marin'
        : 'Kore')
  );
}
export function rememberedVoice(provider: AIMode): Settings['voice'] {
  const saved = preferences().voices[provider];
  const legacy = readVoice();
  return (
    saved ??
    (legacy && voiceProvider(legacy) === provider
      ? legacy
      : provider === 'openai'
        ? 'marin'
        : 'Kore')
  );
}
export function saveVoice(voice: Settings['voice'], mode: AIMode) {
  voiceSchema.parse(voice);
  const saved = preferences();
  saved.modes[mode] = voice;
  saved.voices[voiceProvider(voice)] = voice;
  localStorage.setItem(preferencesKey, JSON.stringify(preferencesSchema.parse(saved)));
}
