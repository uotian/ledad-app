import type { Language } from './schema';

export type TranslationDraft = { text: string; translation: string };
export type TranslationResult = { text: string; usageId: string };

// 原文の更新ごとに送り、表示は原文の新しさに沿って進める。
export class LiveTranslation {
  private previous: TranslationDraft | null = null;
  private text = '';
  private sent = '';
  private generation = 0;
  private requested = 0;
  private displayed = 0;
  private pending = new Map<Promise<TranslationResult>, { text: string; request: number }>();
  private handedOff = new WeakSet<Promise<TranslationResult>>();
  constructor(
    private language: Language,
    private translate: (
      text: string,
      language: Language,
      previous: TranslationDraft | null,
    ) => Promise<TranslationResult>,
    private display: (translation: string, sourceText: string) => void,
    private unused: (usageId: string) => void,
  ) {}
  update(sourceText: string) {
    if (!sourceText.trim()) {
      this.reset();
      this.display('', '');
      return;
    }
    this.text = sourceText.trim();
    if (this.text === this.sent) return;
    const text = this.text;
    this.sent = text;
    const generation = this.generation;
    const request = ++this.requested;
    const pending = this.translate(text, this.language, this.previous);
    this.pending.set(pending, { text, request });
    void pending
      .then((result) => {
        if (this.handedOff.has(pending)) return;
        if (generation !== this.generation || request < this.displayed)
          return this.unused(result.usageId);
        this.displayed = request;
        if (!result.text) {
          this.previous = null;
          this.display('', text);
          return this.unused(result.usageId);
        }
        this.previous = { text, translation: result.text };
        this.display(result.text, text);
      })
      // 暫定訳の失敗は次の更新で回復し、確定後は通常の翻訳とエラー表示に任せる。
      .catch(() => {})
      .finally(() => {
        this.pending.delete(pending);
      });
  }
  reset() {
    this.generation++;
    this.pending.clear();
    this.text = this.sent = '';
    this.previous = null;
  }
  handoff(sourceText = this.text, completeUtterance = false) {
    // Appleでは途中表示の一部だけが確定することもあるため、確定原文と照合する。
    let pending: Promise<TranslationResult> | null = null;
    for (const [candidate, { text, request }] of this.pending)
      if (request >= this.displayed && (completeUtterance || sourceText.trim().startsWith(text)))
        pending = candidate;
    if (pending) this.handedOff.add(pending);
    this.reset();
    return pending;
  }
}
