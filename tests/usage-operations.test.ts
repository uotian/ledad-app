import { expect, it } from 'vitest';
import { compareUsageOperations } from '@/lib/usage/operations';

it('履歴の追加順や更新順によらず、指定の処理順に揃える', () => {
  const expected = [
    'transcript_preview',
    'file_transcription',
    'transcript_analysis',
    'transcript_translation',
    'meeting_analyze',
    'meeting_consultation',
    'meeting_candidates',
  ];
  for (const records of [[...expected].reverse(), expected]) {
    expect(records.sort(compareUsageOperations)).toEqual(expected);
  }
});

it('一部の処理だけでも同じ相対順を保つ', () => {
  expect(['file_transcription', 'speech', 'meeting_analyze'].sort(compareUsageOperations)).toEqual(
    ['file_transcription', 'meeting_analyze', 'speech'],
  );
});

it('未知の処理は既存の処理の後ろに、キーの順で残す', () => {
  expect(['z_new', 'a_new', 'meeting_minutes'].sort(compareUsageOperations)).toEqual([
    'meeting_minutes',
    'a_new',
    'z_new',
  ]);
});
