import type { Session } from './schema';

export function glossaryEntries(session: Session) {
  const entries: { term: string; source: 'document' | 'analyze' }[] = [];
  const seen = new Set<string>();
  const reference = session.documentReference;
  const documents =
    reference?.documentIds.length &&
    reference.documentIds.every((id) => session.documents.some((document) => document.id === id))
      ? reference.glossary
      : [];
  const settled = new Map([
    ...session.transcripts
      .filter((item) => item.correctedAt || item.source === 'manual')
      .map((item) => [item.id, item.text] as const),
    ...session.utterances
      .filter((item) => item.status !== 'playing')
      .map((item) => [item.id, item.completedText] as const),
  ]);
  const sources = [
    ['document', documents],
    [
      'analyze',
      (session.analyze?.glossary ?? [])
        .filter((entry) => settled.get(entry.evidenceId)?.includes(entry.term))
        .map((entry) => entry.term),
    ],
  ] as const;
  for (const [source, terms] of sources) {
    for (const value of terms) {
      const term = value.trim();
      const key = term.toLowerCase();
      if (!key || seen.has(key) || [...term].length > 50 || /[<>\r\n]/u.test(term)) continue;
      seen.add(key);
      entries.push({ term, source });
      if (entries.length === 100) return entries;
    }
  }
  return entries;
}
