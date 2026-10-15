import type { Language } from './schema';

export type TranslationDraft = { text: string; translation: string };
export type TranslationResult = { text: string; usageId: string };

// 表示した訳を受け取ってから次を送り、待機中の原稿は最新にまとめる。
export class LiveTranslation {
  private previous: TranslationDraft | null = null;
  private text = '';
  private sent = '';
  private pending: Promise<TranslationResult> | null = null;
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
  update(text: string) {
    if (!text.trim()) {
      this.reset();
      this.display('', '');
      return;
    }
    this.text = text.trim();
    this.pump();
  }
  private pump() {
    if (!this.text || this.text === this.sent || this.pending) return;
    const text = this.text;
    this.sent = text;
    const pending = this.translate(text, this.language, this.previous);
    this.pending = pending;
    void pending
      .then((result) => {
        if (this.handedOff.has(pending)) return;
        if (this.pending !== pending) return this.unused(result.usageId);
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
        if (this.pending === pending) {
          this.pending = null;
          this.pump();
        }
      });
  }
  reset() {
    this.pending = null;
    this.text = this.sent = '';
    this.previous = null;
  }
  handoff(sourceText = this.text, completeUtterance = false) {
    // Appleでは途中表示の一部だけが確定することもあるため、確定原文と照合する。
    const pending = completeUtterance || sourceText.trim() === this.sent ? this.pending : null;
    if (pending) this.handedOff.add(pending);
    this.reset();
    return pending;
  }
}
