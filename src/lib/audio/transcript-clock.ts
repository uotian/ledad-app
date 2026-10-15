// 音声ストリーム上の発話開始位置を端末の日時へ換算します。
export class TranscriptClock {
  private audioStartedAt?: number;
  private utteranceStartedAt?: string;
  audioSent(bytes: number, capturedAt = Date.now()) {
    // 16kHz / mono / 16bit。最初のチャンクの収録時間を差し引きます。
    this.audioStartedAt ??= capturedAt - bytes / 32;
  }
  activity(activity?: { type?: string; voiceActivityType?: string; audioOffset?: string }) {
    // 実APIはtype、SDKの型定義はvoiceActivityType。両方に対応します。
    if (
      (activity?.type ?? activity?.voiceActivityType) !== 'ACTIVITY_START' ||
      this.utteranceStartedAt
    )
      return;
    const offset = /^(\d+(?:\.\d+)?)s$/.exec(activity?.audioOffset ?? '');
    if (offset && this.audioStartedAt !== undefined) {
      this.utteranceStartedAt = new Date(
        this.audioStartedAt + Number(offset[1]) * 1000,
      ).toISOString();
    }
  }
  interim() {
    return (this.utteranceStartedAt ??= new Date().toISOString());
  }
  final() {
    const timestamp = this.interim();
    this.utteranceStartedAt = undefined;
    return timestamp;
  }
  reset() {
    this.audioStartedAt = undefined;
    this.utteranceStartedAt = undefined;
  }
}
