export type AudioReview = { pcm: Uint8Array; transcriptIds: string[] };
export type ReviewProgress =
  | { state: 'idle' }
  | { state: 'boundary' }
  | { state: 'processing' }
  | { state: 'collecting'; remainingSeconds: number }
  | { state: 'context'; elapsedSeconds: number };
const bytesPerSecond = 32_000;
// 前後に重ねる文脈の長さは、Fix間隔とは別に保つ。
const defaultContextSeconds = 5;

// Liveと同じPCMを保持し、設定した長さの区間に前後の文脈を重ねて送る。
export class ReviewBuffer {
  private chunks: Uint8Array[] = [];
  private total = 0;
  private start = 0; // 次の置換対象区間の開始位置
  private bufferStart = 0; // 前の区間から残した文脈も含む音声の開始位置
  private epoch?: number;
  private records: { id: string | null; start: number }[] = [];
  private ends: number[] = [];
  private ids: string[] = [];
  private skipped = false;
  private overflow = false;
  private pending: { from: number; to: number; ids: string[] }[] = [];
  private contextBytes: number;
  constructor(
    private emit: (review: AudioReview) => void,
    private warn: () => void,
    contextSeconds = defaultContextSeconds,
    private intervalSeconds = 60,
  ) {
    this.contextBytes = Math.round((contextSeconds * bytesPerSecond) / 2) * 2;
  }
  get progress(): ReviewProgress {
    if (this.epoch === undefined) return { state: 'idle' };
    if (this.pending.length)
      return {
        state: 'context',
        elapsedSeconds: Math.max(
          1,
          Math.floor((this.total - (this.pending[0].to - this.contextBytes)) / bytesPerSecond) + 1,
        ),
      };
    const remainingSeconds = Math.ceil(
      (this.intervalSeconds * bytesPerSecond - (this.total - this.start)) / bytesPerSecond,
    );
    return remainingSeconds > 0
      ? {
          state: 'collecting',
          remainingSeconds,
        }
      : { state: 'boundary' };
  }
  append(pcm: Uint8Array, capturedAt = Date.now()) {
    this.epoch ??= capturedAt - pcm.length / 32;
    this.total += pcm.length;
    if (!this.overflow) this.chunks.push(pcm.slice());
    this.flushPending(false);
    if (this.total - this.start > 180 * bytesPerSecond && !this.overflow) {
      this.chunks = [];
      this.pending = [];
      this.overflow = true;
      this.warn();
    }
  }
  record(id: string | null, timestamp: string) {
    if (this.epoch === undefined) return;
    const start = Math.max(0, (Date.parse(timestamp) - this.epoch) * 32);
    if (!id) this.pending = this.pending.filter((review) => review.to <= start);
    this.records.push({ id, start });
    this.match();
  }
  boundary(offset: string | undefined) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(offset ?? '');
    if (!match) return;
    const end = Math.min(this.total, Math.round((Number(match[1]) * bytesPerSecond) / 2) * 2);
    if (end <= this.start) return;
    this.ends.push(end);
    this.match();
  }
  private match() {
    while (this.records.length && this.ends.length) {
      if (this.ends[0] < this.records[0].start) {
        this.ends.shift();
        continue;
      }
      const record = this.records.shift()!;
      const end = this.ends.shift()!;
      if (record.id) this.ids.push(record.id);
      else this.skipped = true;
      if (end - this.start >= this.intervalSeconds * bytesPerSecond) this.seal(end);
    }
  }
  private joined() {
    const bytes = new Uint8Array(this.total - this.bufferStart);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  private trim() {
    if (this.overflow) return;
    const earliest = Math.min(
      Math.max(0, this.start - this.contextBytes),
      ...this.pending.map((p) => p.from),
    );
    const next = Math.max(this.bufferStart, earliest);
    if (next > this.bufferStart) {
      this.chunks = [this.joined().slice(next - this.bufferStart)];
      this.bufferStart = next;
    }
  }
  private flushPending(final: boolean) {
    if (!this.pending.length || (!final && this.pending[0].to > this.total)) return;
    const bytes = this.joined();
    while (this.pending.length && (final || this.pending[0].to <= this.total)) {
      const review = this.pending.shift()!;
      this.emit({
        pcm: bytes.slice(
          review.from - this.bufferStart,
          Math.min(review.to, this.total) - this.bufferStart,
        ),
        transcriptIds: review.ids,
      });
    }
    this.trim();
  }
  private seal(end: number) {
    if (!this.overflow && !this.skipped && this.ids.length && end > this.start)
      this.pending.push({
        from: Math.max(this.bufferStart, this.start - this.contextBytes),
        to: end + this.contextBytes,
        ids: [...this.ids],
      });
    if (this.overflow) {
      this.start = this.bufferStart = this.total;
      this.chunks = [];
    } else this.start = end;
    // 除外済みエコーのある区間からは、次の区間へ音声を持ち越さない。
    if (this.skipped && !this.overflow) {
      this.pending = [];
      this.chunks = [this.joined().slice(end - this.bufferStart)];
      this.bufferStart = end;
    }
    this.ids = [];
    this.skipped = this.overflow = false;
    this.flushPending(false);
    this.trim();
  }
  finish() {
    for (const record of this.records) {
      if (record.id) this.ids.push(record.id);
      else this.skipped = true;
    }
    this.records = [];
    this.ends = [];
    this.seal(this.total);
    // 終了時は未来の5秒を待たず、既に取得した音声だけで処理する。
    this.flushPending(true);
    this.chunks = [];
    this.bufferStart = this.start = this.total;
  }
}
