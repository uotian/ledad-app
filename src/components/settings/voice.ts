import { settingsSchema } from '@/lib/session/schema';
import type { Settings } from '@/lib/session/schema';

const voiceStorageKey = 'ledad.voice';
export function readVoice(): Settings['voice'] | null {
  try {
    const parsed = settingsSchema.shape.voice.safeParse(localStorage.getItem(voiceStorageKey));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function saveVoice(voice: Settings['voice']) {
  localStorage.setItem(voiceStorageKey, settingsSchema.shape.voice.parse(voice));
}
