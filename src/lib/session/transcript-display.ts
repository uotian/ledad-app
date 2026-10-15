const sentences = new Intl.Segmenter('ja', { granularity: 'sentence' });

// 文の境界で表示だけを改行し、小数点やURL内のピリオドは保ちます。
export function formatTranscript(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      Array.from(sentences.segment(line), ({ segment }) => segment.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

// UI言語にかかわらず、端末の現地時刻を24時間表記で表示します。
export function formatTranscriptTime(timestamp: string): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
