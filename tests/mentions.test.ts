import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mentionsKey,
  reconcileMentions,
  type MentionAnalysis,
  type Conversation,
} from '@/lib/session/analyze';

const first = { id: 'live1', text: '内藤さん、確認を', timestamp: '2026-10-15T00:00:00Z' };
const other = { ...first, id: 'fix2', text: '次の話', settled: true };
const result: MentionAnalysis = {
  mentions: [
    { evidenceId: first.id, kind: 'request', quote: first.text, summary: '確認' },
    { evidenceId: other.id, kind: 'mention', quote: other.text, summary: '次' },
  ],
  mentionSources: { [first.id]: 'live-hash', [other.id]: 'fix-hash' },
  updatedAt: first.timestamp,
  language: 'ja',
  profileKey: '{}',
  inputKey: 'snapshot',
};
describe('@You source revisions', () => {
  it.each(
    [
      [{ ...first, settled: true }, other],
      [{ ...first, text: '内田さん、確認を' }, other],
      [{ ...other, id: 'merged-fix' }],
    ].map((current) => ({ current })),
  )('discards stale Live on correction, settlement or merge', ({ current }) => {
    const reconciled = reconcileMentions(result, [first, other], current);
    expect(reconciled.mentions.some((item) => item.evidenceId === first.id)).toBe(false);
    expect(reconciled.mentionSources?.[first.id]).toBeUndefined();
    expect(result.mentions).toHaveLength(2);
  });
  it('keeps valid completed work when new conversation arrives', () => {
    const current = [first, other, { ...other, id: 'new' }];
    expect(reconcileMentions(result, [first, other], current)).toEqual(result);
  });
  it('uses the same input signature as the backend and detects Live to Fix', async () => {
    const conversation: Conversation = [first];
    const expected = createHash('sha256')
      .update(JSON.stringify({ version: 1, conversation, profileKey: '{}', language: 'ja' }))
      .digest('hex');
    expect(await mentionsKey(conversation, '{}', 'ja')).toBe(expected);
    expect(await mentionsKey([{ ...first, settled: true }], '{}', 'ja')).not.toBe(expected);
  });
});
