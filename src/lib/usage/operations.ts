const operationOrder = [
  'transcript_preview',
  'file_transcription',
  'transcript_analysis',
  'transcript_translation',
  'meeting_insights',
  'meeting_analyze',
  'mention_detection',
  'meeting_mentions',
  'meeting_consultation',
  'meeting_candidates',
  'live_transcription',
  'live_token',
  'speech',
  'candidate_confirmation',
  'background_guidance',
  'document_preparation',
  'meeting_minutes',
];

export function compareUsageOperations(a: string, b: string): number {
  const aIndex = operationOrder.indexOf(a);
  const bIndex = operationOrder.indexOf(b);
  return (
    (aIndex < 0 ? operationOrder.length : aIndex) - (bIndex < 0 ? operationOrder.length : bIndex) ||
    a.localeCompare(b)
  );
}
