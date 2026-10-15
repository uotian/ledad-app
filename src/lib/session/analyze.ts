import { z } from 'zod';
import type { Session } from '@/lib/session/schema';
import { documentsFor } from '@/lib/session/policy';

export type Conversation = {
  id: string;
  text: string;
  timestamp: string;
  settled?: boolean;
  endTimestamp?: string;
}[];
export const analyzeSchema = z.object({
  startedAt: z.iso.datetime().nullable().optional(),
  context: z
    .object({
      summary: z.string().min(1).max(6000),
      coveredCount: z.number().int().positive(),
      sourceKey: z.string(),
    })
    .nullable()
    .optional(),
  topicEvidence: z.record(z.string(), z.string()).optional(),
  mentionSources: z.record(z.string(), z.string()).optional(),
  suggestedQuestions: z.array(z.string()).default([]),
  suggestedMeetingQuestions: z.array(z.string()).default([]),
  topics: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  mentions: z.array(
    z.object({
      kind: z.enum(['mention', 'question', 'request']),
      summary: z.string(),
      evidenceId: z.string(),
      quote: z.string(),
    }),
  ),
  updatedAt: z.iso.datetime(),
  language: z.enum(['ja', 'en', 'zh', 'fr']),
  profileKey: z.string().max(1000),
  inputKey: z.string().max(100),
});
export const mentionAnalysisSchema = analyzeSchema.pick({
  mentions: true,
  mentionSources: true,
  updatedAt: true,
  language: true,
  profileKey: true,
  inputKey: true,
});
export type MentionAnalysis = z.infer<typeof mentionAnalysisSchema>;

export async function mentionsKey(
  conversation: Conversation,
  profileKey: string,
  language: string,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, conversation, profileKey, language }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A late Live response must never replace the revision already corrected by Fix.
export function reconcileMentions(
  result: MentionAnalysis,
  sent: Conversation,
  current: Conversation,
): MentionAnalysis {
  const revisions = new Map(
    current.map((item) => [item.id, JSON.stringify([item.text, !!item.settled])]),
  );
  const valid = new Set(
    sent
      .filter((item) => revisions.get(item.id) === JSON.stringify([item.text, !!item.settled]))
      .map((item) => item.id),
  );
  return {
    ...result,
    mentions: result.mentions.filter((item) => valid.has(item.evidenceId)),
    mentionSources: Object.fromEntries(
      Object.entries(result.mentionSources ?? {}).filter(([id]) => valid.has(id)),
    ),
  };
}

export type Analyze = z.infer<typeof analyzeSchema>;
export function conversationForAnalyze(session: Session): Conversation {
  // 未確定の速報、未発話の候補、私的なチャットは会話の根拠に含めません。
  return [
    ...session.transcripts.map(({ id, text, timestamp, correctedAt, source, liveSegments }) => ({
      id,
      text,
      timestamp,
      ...(correctedAt || source === 'manual' ? { settled: true } : {}),
      ...(liveSegments?.length
        ? {
            endTimestamp: liveSegments.reduce(
              (end, part) => (part.timestamp > end ? part.timestamp : end),
              timestamp,
            ),
          }
        : {}),
    })),
    ...session.utterances
      .filter((u) => u.completedText.trim())
      .map((u) => ({
        id: u.id,
        text: u.completedText,
        timestamp: u.startedAt,
        ...(u.status !== 'playing' ? { settled: true } : {}),
        ...(u.endedAt ? { endTimestamp: u.endedAt } : {}),
      })),
  ]
    .filter((entry) => entry.text.trim())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
export async function analyzeKey(
  conversation: Conversation,
  profileKey: string,
  language: string,
  documents: ReturnType<typeof documentsFor> = '',
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 16, conversation, profileKey, language, documents }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function mentionId(mention: Analyze['mentions'][number]) {
  return `${mention.evidenceId}:${mention.kind}`;
}

export function mentionTimestamp(session: Session, evidenceId: string): string | null {
  for (const transcript of session.transcripts) {
    const original = transcript.liveSegments?.find((part) => part.id === evidenceId);
    if (original) return original.timestamp;
    if (transcript.id === evidenceId) return transcript.timestamp;
  }
  return (
    session.utterances.find((u) => u.id === evidenceId && u.completedText.trim())?.startedAt ?? null
  );
}

export function visibleMentions(session: Session, mentions: Analyze['mentions']) {
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s、。！？!?「」『』“”]/gu, '');
  const visible: (Analyze['mentions'][number] & { timestamp: string | null })[] = [];
  for (const mention of mentions) {
    const timestamp = mentionTimestamp(session, mention.evidenceId);
    const quote = normalize(mention.quote);
    const duplicate = visible.some((previous) => {
      if (previous.kind !== mention.kind || !timestamp || !previous.timestamp) return false;
      const distance = Math.abs(Date.parse(timestamp) - Date.parse(previous.timestamp));
      if (!Number.isFinite(distance) || distance > 30_000) return false;
      const previousQuote = normalize(previous.quote);
      // 短い名前だけの一致や、要点が違う訂正・追加情報はまとめません。
      if (Math.min(quote.length, previousQuote.length) < 12) return false;
      return (
        quote === previousQuote ||
        (normalize(mention.summary) === normalize(previous.summary) &&
          (quote.includes(previousQuote) || previousQuote.includes(quote)))
      );
    });
    if (!duplicate) visible.push({ ...mention, timestamp });
  }
  return visible;
}
