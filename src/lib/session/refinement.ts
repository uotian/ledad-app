import type { Language, Transcript } from './schema';

export type Refinement = {
  originals: { id: string; text: string }[];
  text: string;
  translation: string;
  translationLanguage: Language;
};

// 統合前の発言を参照している候補・発話も、同じFixed区間へ辿れるようにする。
export function matchesTranscript(item: Transcript, id: string | null | undefined) {
  return !!id && (item.id === id || !!item.liveSegments?.some((part) => part.id === id));
}
