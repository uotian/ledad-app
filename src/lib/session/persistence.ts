import { api, ApiError } from '@/lib/api';
import type { MeetingCommand } from './commands';
import { documentReferenceSchema, type Session, type Settings, type Language } from './schema';
import { createSession } from './defaults';
import { meetingTimes } from './meeting-time';

type Change = (session: Session) => Session;
type Transition = {
  commandId: string;
  command: MeetingCommand;
  snapshot: Session | null;
  changes: Change[];
};
type View = {
  session: (value: Session) => void;
  error: (value: string) => void;
  saving: (value: boolean) => void;
};

// Serialize local saves and Python transitions. Edits made while a transition is
// in flight are replayed onto its result, before any queued save takes a snapshot.
export class SessionPersistence {
  readonly ref = { current: null as Session | null };
  dirty = false;
  private queue: Promise<unknown> = Promise.resolve();
  private transition: Transition | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = 0;
  private attached = true;
  private persisted: boolean;
  private loading?: Promise<Session>;
  private translationLanguage: Language = 'ja';
  private preparation?: Promise<void>;
  get saved() {
    return this.persisted;
  }
  get unsaved() {
    return this.dirty || this.pending > 0 || this.transition !== null || !!this.preparation;
  }

  constructor(
    private id: string | undefined,
    private view: View,
  ) {
    this.persisted = !!id;
  }

  load = (language: Language = 'ja'): Promise<Session> => {
    if (this.loading) return this.loading;
    this.translationLanguage = language;
    this.loading = (
      this.id
        ? this.command({ type: 'restore' })
        : this.enqueue(async () => {
            const settings = await api<Settings>('/api/meeting-settings');
            const session = createSession();
            session.settings = {
              ...settings,
              translationLanguage: settings.translationLanguage ?? language,
            };
            this.id = session.id;
            this.publish(session);
            return session;
          })
    ).catch((error) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  };

  ensureSaved = () => {
    if (!this.persisted && this.ref.current) this.dirty = true;
    return this.flush();
  };

  private publish(session: Session) {
    session = {
      ...session,
      ...meetingTimes(session),
      settings: {
        ...session.settings,
        translationLanguage: session.settings.translationLanguage ?? this.translationLanguage,
      },
    };
    this.ref.current = session;
    if (this.attached) this.view.session(session);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.pending++;
    if (this.attached) this.view.saving(true);
    const work = this.queue
      .then(operation)
      .then((value) => {
        if (this.attached) this.view.error('');
        return value;
      })
      .catch((error: unknown) => {
        if (this.attached && !(error instanceof DOMException && error.name === 'AbortError'))
          this.view.error(error instanceof Error ? error.message : '保存できませんでした。');
        throw error;
      })
      .finally(() => {
        this.pending--;
        if (this.attached) this.view.saving(this.pending > 0);
      });
    // A failed operation is returned to its caller; it must not poison later retries.
    this.queue = work.catch(() => {});
    return work;
  }

  update = (change: Change) => {
    if (!this.ref.current) return;
    const now = new Date().toISOString();
    const apply: Change = (session) => {
      const updated = { ...change(session), updatedAt: now };
      if (
        JSON.stringify(updated.documents.map((d) => d.id)) !==
        JSON.stringify(session.documents.map((d) => d.id))
      ) {
        if (
          session.documents.some((d) => !updated.documents.some((current) => current.id === d.id))
        )
          updated.documentReference = { documentIds: [], summary: '', glossary: [] };
        updated.documents = updated.documents.map((d) => ({ ...d, preparationPending: true }));
      }
      return updated;
    };
    this.publish(apply(this.ref.current));
    this.transition?.changes.push(apply);
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 250);
  };

  flush = () => {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      await this.finishTransition();
      // Take the snapshot when our turn arrives, never before another command.
      if (!this.ref.current || !this.dirty) return;
      const snapshot = this.ref.current;
      this.dirty = false;
      try {
        if (!this.persisted) {
          const created = await api<Session>('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ id: this.id, title: snapshot.title }),
          });
          this.persisted = true;
          snapshot.shareToken = created.shareToken;
          this.publish({ ...this.ref.current!, shareToken: created.shareToken });
        }
        await api(`/api/sessions/${this.id}`, { method: 'PUT', body: JSON.stringify(snapshot) });
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
  };

  command = (command: MeetingCommand, signal?: AbortSignal) => {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      await this.finishTransition();
      if (signal?.aborted) throw new DOMException('取消', 'AbortError');
      this.transition = {
        commandId: crypto.randomUUID(),
        command,
        snapshot: this.ref.current,
        changes: [],
      };
      await this.finishTransition();
      return this.ref.current!;
    });
  };

  prepareDocuments = (): Promise<void> => {
    if (this.preparation) return this.preparation;
    this.preparation = (async () => {
      const ids = await this.enqueue(async () => {
        await this.finishTransition();
        return this.ref.current?.documents.map((d) => d.id) ?? [];
      });
      // AI waiting must not block transcript saves or meeting commands.
      const reference = documentReferenceSchema.parse(
        await api(`/api/sessions/${this.id}/document-reference`, { method: 'POST' }),
      );
      if (JSON.stringify(reference.documentIds) !== JSON.stringify(ids))
        throw new Error('資料が一致しません。');
      await this.enqueue(async () => {
        await this.finishTransition();
        if (
          this.ref.current &&
          JSON.stringify(this.ref.current.documents.map((d) => d.id)) === JSON.stringify(ids)
        )
          this.publish({
            ...this.ref.current,
            documentReference: reference,
            documents: this.ref.current.documents.map((d) => ({ ...d, preparationPending: false })),
          });
      });
    })().finally(() => {
      this.preparation = undefined;
    });
    return this.preparation;
  };

  private async finishTransition() {
    const pending = this.transition;
    if (!pending) return;
    const { commandId, command, snapshot } = pending;
    let saved: Session;
    try {
      saved = await api<Session>(`/api/sessions/${this.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({ commandId, command, snapshot }),
      });
    } catch (error) {
      // A rejected input was not committed. Transport/server failures are
      // uncertain, so keep the receipt ID and retry before the next write.
      if (error instanceof ApiError && [400, 403, 404, 405, 413, 422].includes(error.status))
        this.transition = null;
      throw error;
    }
    this.dirty = pending.changes.length > 0;
    this.transition = null;
    this.publish(pending.changes.reduce((session, apply) => apply(session), saved));
  }

  attach = () => {
    this.attached = true;
  };
  detach = () => {
    this.attached = false;
    clearTimeout(this.timer);
  };
}
