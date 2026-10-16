import type { UsageMetadata } from '@google/genai';
import { api } from '@/lib/api';
type Status = 'running' | 'completed' | 'failed' | 'cancelled';
type LiveReport = {
  at: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
export class LiveUsage {
  private seconds = 0;
  private reports: LiveReport[] = [];
  private messages: string[] = [];
  private messageCharacters = 0;
  private messagesTruncated = false;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private id: string,
    private sessionId: string,
    private onError: () => void,
  ) {
    this.timer = setInterval(() => this.save('running'), 5000);
  }
  sent(bytes: number) {
    this.seconds += bytes / (16000 * 2);
  }
  received(usage: UsageMetadata) {
    this.reports.push({
      at: new Date().toISOString(),
      inputTokens: usage.promptTokenCount ?? null,
      outputTokens: usage.responseTokenCount ?? null,
      totalTokens: usage.totalTokenCount ?? null,
    });
  }
  message(message: unknown) {
    const json = JSON.stringify(message, (key, value) =>
      key === 'data' && typeof value === 'string'
        ? { omitted: 'binary', encodedCharacters: value.length }
        : value,
    );
    // ponytail: keep a bounded Live trace; use paged event storage if longer traces are needed.
    if (
      this.messagesTruncated ||
      this.messages.length >= 2000 ||
      this.messageCharacters + json.length > 2_000_000
    ) {
      this.messagesTruncated = true;
      return;
    }
    this.messages.push(json);
    this.messageCharacters += json.length;
  }
  private save(status: Status) {
    const body = JSON.stringify({
      id: this.id,
      sessionId: this.sessionId,
      status,
      audioInputSeconds: this.seconds,
      liveReports: this.reports,
      liveMessages: this.messages,
      liveMessagesTruncated: this.messagesTruncated,
    });
    this.queue = this.queue
      .catch(() => {})
      .then(() => api('/api/usage', { method: 'POST', body }))
      .catch(this.onError);
  }
  stop(status: 'completed' | 'failed' | 'cancelled' = 'completed') {
    if (this.stopped) return this.queue;
    this.stopped = true;
    clearInterval(this.timer);
    this.save(status);
    return this.queue;
  }
}
