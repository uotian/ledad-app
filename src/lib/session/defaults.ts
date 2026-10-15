import type { Session } from './schema';
export const languageNames = {
  ja: '日本語',
  en: 'English',
  zh: '中文（简体）',
  fr: 'Français',
} as const;
export function createSession(title?: string): Session {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    shareToken: crypto.randomUUID(),
    title: title?.trim() || '新しい会議',
    mode: 'audience',
    status: 'preparing',
    createdAt: now,
    updatedAt: now,
    meetingStartedAt: null,
    meetingLastAt: null,
    startedAt: null,
    endedAt: null,
    pricing: null,
    settings: {
      language: 'ja',
      translationLanguage: null,
      input: 'mixed',
      voice: 'Kore',

      vadSilenceMs: 100,
      fixIntervalSeconds: 30,
      listeningLimitMinutes: 30,
    },
    documents: [],
    documentReference: null,
    scripts: [],
    currentPage: 1,
    presentationDocumentId: null,
    transcripts: [],
    candidates: [],
    chats: [],
    utterances: [],
    minutes: null,
    analyze: null,
    caption: '',
    appliedCommands: [],
  };
}
