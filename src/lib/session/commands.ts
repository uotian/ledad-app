import type { Candidate, Minutes, Utterance } from './schema';
import type { Refinement } from './refinement';

// Python owns these transitions; the UI only supplies user intent and device events.
export type MeetingCommand =
  | { type: 'restore' | 'start' | 'end' }
  | {
      type: 'candidates';
      targetId: string | null;
      candidates: Pick<
        Candidate,
        'title' | 'text' | 'spokenText' | 'translationLanguage' | 'caution'
      >[];
    }
  | { type: 'dismiss'; targetId: string | null; status: 'deferred' | 'skipped' }
  | { type: 'utterance'; record: Utterance }
  | { type: 'refinement'; expectedIds: string[]; result: Refinement }
  | { type: 'chat-start'; id: string; text: string; retry: boolean }
  | { type: 'chat-result'; id: string; reply: string }
  | { type: 'chat-failed'; id: string }
  | { type: 'minutes'; minutes: Minutes };
