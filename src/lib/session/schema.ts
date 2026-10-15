import { z } from 'zod';
import { pricingSnapshotSchema } from '@/lib/usage/pricing';
import { analyzeSchema, mentionAnalysisSchema } from '@/lib/session/analyze';

// 旧Presenterの保存データを欠落なく読み書きするための互換項目。モード選択は廃止。
const modeSchema = z.enum(['presenter', 'audience']);
export const languageSchema = z.enum(['ja', 'en', 'zh', 'fr']);
const id = z.string().uuid();
const text = z.string().max(100_000);
export const documentSchema = z.object({
  id,
  name: z.string().max(250),
  kind: z.enum(['presentation', 'reference', 'script']),
  format: z.enum(['pdf', 'text', 'image', 'presentation']),
  pages: z.array(z.object({ number: z.number().int().positive(), text })).max(200),
  size: z.number().nonnegative(),
  preparationPending: z.boolean().default(false),
});
export const documentReferenceSchema = z.preprocess(
  (value) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      !('summary' in value) &&
      'markdown' in value
    ) {
      return { ...value, summary: value.markdown };
    }
    return value;
  },
  z.object({
    documentIds: z.array(id).max(30),
    summary: z.string().max(6_000),
    glossary: z
      .array(
        z.union([
          z.string().min(1).max(100),
          z.object({ term: z.string().min(1).max(100) }).transform((entry) => entry.term),
        ]),
      )
      .max(100),
  }),
);
export const scriptSchema = z.object({
  page: z.number().int().positive(),
  original: text,
  spoken: text,
});
export const transcriptSchema = z.object({
  id,
  text,
  translation: text,
  liveSegments: z
    .array(
      z.object({
        id,
        text,
        timestamp: z.string(),
        disposition: z.enum(['open', 'deferred', 'skipped', 'answered']),
      }),
    )
    .max(300)
    .optional(), // 統合した速報の原文・開始時刻・参照ID。
  liveText: text.optional(), // 録音で再認識する前の原文。
  correctedAt: z.iso.datetime().optional(),
  translationLanguage: languageSchema.optional(), // 旧保存済み訳は日本語として扱います。
  timestamp: z.string(),
  source: z.enum(['microphone', 'display', 'mixed', 'manual']),

  analyzed: z.boolean(),
  disposition: z.enum(['open', 'deferred', 'skipped', 'answered']),
});
export const candidateSchema = z.object({
  id,
  title: z.string(),
  text,
  spokenText: text,
  translationLanguage: languageSchema.optional(),
  caution: z.string(),
  targetId: z.string().nullable(),
  createdAt: z.string(),
  status: z.enum(['ready', 'deferred', 'skipped', 'speaking', 'spoken']),
});
export const utteranceSchema = z.object({
  id,
  kind: z.enum(['speech', 'presentation', 'question', 'answer']),
  candidateId: z.string().nullable(),
  targetId: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  plannedText: text,
  completedText: text,
  status: z.enum(['playing', 'interrupted', 'completed', 'failed']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  elapsedSeconds: z.number().nonnegative(),
});
export const minutesSchema = z.object({
  summary: z.array(z.string()),
  decisions: z.array(z.string()),
  actions: z.array(z.string()),
  questions: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      status: z.enum(['answered', 'unanswered', 'uncertain']),
      evidenceIds: z.array(z.string()),
    }),
  ),
  caveats: z.array(z.string()),
});
export const settingsSchema = z.object({
  language: languageSchema,
  translationLanguage: languageSchema.nullable().default(null), // 旧設定のnull・未指定は読み込み時に翻訳先を固定します。
  // 旧「聞き取りなし」は既定のマイクへ移行。会話の source: manual はそのまま残します。
  input: z.preprocess(
    (value) => (value === 'manual' ? 'microphone' : value),
    z.enum(['microphone', 'display', 'mixed']),
  ),
  voice: z.enum(['Kore', 'Puck', 'Aoede', 'Charon']),

  vadSilenceMs: z
    .union([z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(500)])
    .default(100),
  fixIntervalSeconds: z
    .union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)])
    .default(30),
  listeningLimitMinutes: z.preprocess(
    (value) => (value === 3 ? 10 : value),
    z.union([z.literal(10), z.literal(30), z.literal(60), z.literal(90)]).default(30),
  ),
});
export const sessionSchema = z.preprocess(
  (value) => {
    if (value && typeof value === 'object' && !('analyze' in value) && 'insights' in value) {
      return { ...value, analyze: value.insights };
    }
    return value;
  },
  z.object({
    id,
    shareToken: id,
    title: z
      .string()
      .max(120)
      .transform((value) => value.trim() || '新しい会議'),
    mode: modeSchema,
    status: z.enum(['preparing', 'active', 'ended']),
    createdAt: z.string(),
    updatedAt: z.string(),
    meetingStartedAt: z.iso.datetime().nullable().default(null),
    meetingLastAt: z.iso.datetime().nullable().default(null),
    // 開始・終了操作の履歴。会議の記録範囲は上の2項目に分けます。
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    settings: settingsSchema,
    pricing: pricingSnapshotSchema.nullable().default(null),
    documents: z.array(documentSchema).max(30),
    documentReference: documentReferenceSchema.nullable().default(null),
    scripts: z.array(scriptSchema).max(200),
    currentPage: z.number().int().positive(),
    presentationDocumentId: z.string().nullable(),
    transcripts: z.array(transcriptSchema).max(10_000),
    candidates: z.array(candidateSchema).max(1000),
    chats: z
      .array(
        z.object({
          id,
          text,
          kind: z.enum(['instruction', 'consultation']).default('instruction'),
          reply: text.default(''),
          createdAt: z.string(),
          repliedAt: z.string().nullable().optional(),
          status: z.enum(['pending', 'applied', 'failed']),
        }),
      )
      .max(1000),
    utterances: z.array(utteranceSchema).max(10_000),
    minutes: minutesSchema.nullable(),
    analyze: analyzeSchema.nullable().default(null),
    mentionAnalysis: mentionAnalysisSchema.nullable().optional(),
    caption: z.string().max(4000),
    appliedCommands: z.array(id).max(128).default([]),
  }),
);
export type Session = z.infer<typeof sessionSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Utterance = z.infer<typeof utteranceSchema>;
export type Minutes = z.infer<typeof minutesSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Language = z.infer<typeof languageSchema>;
export type SessionSummary = Pick<
  Session,
  | 'id'
  | 'title'
  | 'mode'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'meetingStartedAt'
  | 'meetingLastAt'
  | 'startedAt'
  | 'endedAt'
> & { hasMinutes: boolean };
