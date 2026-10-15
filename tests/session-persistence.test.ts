import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionPersistence } from '@/lib/session/persistence';
import { createSession } from '@/lib/session/defaults';
import { documentSchema, type Session } from '@/lib/session/schema';
import { ApiError } from '@/lib/api';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: mock.api,
}));
let store: SessionPersistence;
const makeView = () => ({
  session: vi.fn<(value: Session) => void>(),
  error: vi.fn<(value: string) => void>(),
  saving: vi.fn<(value: boolean) => void>(),
});
let view: ReturnType<typeof makeView>;
beforeEach(() => {
  vi.useFakeTimers();
  mock.api.mockReset();
  view = makeView();
  const session = createSession();
  store = new SessionPersistence(session.id, view);
  store.ref.current = session;
});
afterEach(() => {
  store.detach();
  vi.useRealTimers();
});

it('入力エラーで拒否された操作を再送せず、編集と後続の操作を保持する', async () => {
  mock.api.mockRejectedValueOnce(new ApiError('入力を確認してください', 422));
  store.update((session) => ({ ...session, title: '保持する編集' }));
  await expect(store.command({ type: 'start' })).rejects.toThrow('入力を確認してください');
  mock.api.mockImplementation(async (_path, options) => {
    const { snapshot } = JSON.parse(options.body);
    return { ...snapshot, status: 'ended' };
  });
  await store.command({ type: 'end' });
  expect(mock.api).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mock.api.mock.lastCall![1].body).command.type).toBe('end');
  expect(store.ref.current).toMatchObject({ title: '保持する編集', status: 'ended' });
  expect(store.unsaved).toBe(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('資料生成を待たずに編集を保存し、完了後も編集と共通結果を保持する', async () => {
  const document = documentSchema.parse({
    id: crypto.randomUUID(),
    name: '資料.txt',
    kind: 'reference',
    format: 'text',
    size: 10,
    pages: [],
    preparationPending: true,
  });
  store.ref.current!.documents = [document];
  const server = deferred<unknown>();
  const entered = deferred<void>();
  mock.api
    .mockImplementationOnce(() => {
      entered.resolve();
      return server.promise;
    })
    .mockResolvedValue({ saved: true });
  const preparation = store.prepareDocuments();
  await entered.promise;
  store.update((session) => ({ ...session, title: '生成中の編集' }));
  const saving = store.flush();
  await saving;
  expect(JSON.parse(mock.api.mock.lastCall![1].body)).toMatchObject({
    title: '生成中の編集',
    documents: [document],
  });
  const prepared = { ...document, preparationPending: false };
  server.resolve({ documentIds: [document.id], summary: '参照文', glossary: [] });
  await preparation;
  store.update((session) => ({ ...session, title: '生成中の編集' }));
  await store.flush();
  expect(JSON.parse(mock.api.mock.lastCall![1].body)).toMatchObject({
    title: '生成中の編集',
    documents: [prepared],
    documentReference: { documentIds: [document.id], summary: '参照文', glossary: [] },
  });
  expect(store.ref.current!.documents).toEqual([prepared]);
});

it('資料生成の失敗は次の保存で自動再送せず、明示的に再試行できる', async () => {
  const document = documentSchema.parse({
    id: crypto.randomUUID(),
    name: '資料.txt',
    kind: 'reference',
    format: 'text',
    size: 10,
    pages: [],
    preparationPending: true,
  });
  store.ref.current!.documents = [document];
  mock.api.mockRejectedValueOnce(new ApiError('資料生成失敗', 502));
  await expect(store.prepareDocuments()).rejects.toThrow('資料生成失敗');
  await store.flush();
  expect(mock.api).toHaveBeenCalledOnce();
  expect(store.ref.current!.documents[0].preparationPending).toBe(true);
  mock.api.mockResolvedValueOnce({ documentIds: [document.id], summary: '参照文', glossary: [] });
  await store.prepareDocuments();
  expect(store.ref.current!.documents[0].preparationPending).toBe(false);
});

it('Python応答の待機中の編集を保持し、その後の保存に古いスナップショットを使わない', async () => {
  const server = deferred<Session>();
  const entered = deferred<void>();
  const initial = structuredClone(store.ref.current!);
  mock.api
    .mockImplementationOnce(() => {
      entered.resolve();
      return server.promise;
    })
    .mockResolvedValue({ saved: true });
  const command = store.command({ type: 'start' });
  await entered.promise;
  store.update((session) => ({ ...session, title: '応答待ちの間に編集' }));
  const flushed = store.flush();
  server.resolve({ ...initial, status: 'active', startedAt: '2026-10-08T00:00:00Z' });
  await command;
  await flushed;
  expect(store.ref.current).toMatchObject({ title: '応答待ちの間に編集', status: 'active' });
  expect(JSON.parse(mock.api.mock.calls[1][1].body)).toMatchObject({
    title: '応答待ちの間に編集',
    status: 'active',
  });
  expect(store.dirty).toBe(false);
});

it('保存失敗を次の保存で再試行し、Python操作も順番を守る', async () => {
  mock.api.mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValueOnce({ saved: true });
  store.update((session) => ({ ...session, title: '失わない編集' }));
  await expect(store.flush()).rejects.toThrow('保存失敗');
  expect(store.dirty).toBe(true);
  await store.flush();
  expect(JSON.parse(mock.api.mock.calls[1][1].body).title).toBe('失わない編集');
  mock.api.mockImplementation(async (_path, options) => {
    const { snapshot, command } = JSON.parse(options.body);
    return { ...snapshot, status: command.type === 'start' ? 'active' : 'ended' };
  });
  const start = store.command({ type: 'start' });
  const end = store.command({ type: 'end' });
  await Promise.all([start, end]);
  const final = JSON.parse(mock.api.mock.lastCall![1].body);
  expect(final.snapshot.status).toBe('active');
  expect(store.ref.current?.status).toBe('ended');
});

it('前の保存中の編集は保存済み扱いにせず、次のflushで送る', async () => {
  const server = deferred<unknown>();
  const entered = deferred<void>();
  mock.api
    .mockImplementationOnce(() => {
      entered.resolve();
      return server.promise;
    })
    .mockResolvedValue({});
  store.update((session) => ({ ...session, title: '最初' }));
  const saving = store.flush();
  await entered.promise;
  store.update((session) => ({ ...session, title: '追加編集' }));
  server.resolve({});
  await saving;
  expect(store.dirty).toBe(true);
  await store.flush();
  expect(JSON.parse(mock.api.mock.lastCall![1].body).title).toBe('追加編集');
});

it('画面を離れた後の応答は別画面へ表示せず、取り消された待機操作は送信しない', async () => {
  const response = deferred<Session>();
  mock.api.mockReturnValueOnce(response.promise);
  const command = store.command({ type: 'start' });
  store.detach();
  response.resolve({ ...store.ref.current!, status: 'active' });
  await command;
  expect(view.session).not.toHaveBeenCalled();
  const abort = new AbortController();
  abort.abort();
  await expect(store.command({ type: 'end' }, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(mock.api).toHaveBeenCalledOnce();
});

it('操作の応答を失っても同じ識別子で再試行し、待機中の編集を保持する', async () => {
  const initial = structuredClone(store.ref.current!);
  mock.api
    .mockRejectedValueOnce(new Error('応答を失いました'))
    .mockResolvedValueOnce({ ...initial, status: 'active' })
    .mockResolvedValueOnce({ saved: true });
  await expect(store.command({ type: 'start' })).rejects.toThrow('応答を失いました');
  expect(store.unsaved).toBe(true);
  store.update((session) => ({ ...session, title: '失敗後の編集' }));
  await store.flush();
  const first = JSON.parse(mock.api.mock.calls[0][1].body);
  const retry = JSON.parse(mock.api.mock.calls[1][1].body);
  expect(retry).toEqual(first);
  expect(store.ref.current).toMatchObject({ title: '失敗後の編集', status: 'active' });
  expect(JSON.parse(mock.api.mock.calls[2][1].body).title).toBe('失敗後の編集');
  expect(store.unsaved).toBe(false);
});

it('後続操作の取消でも応答不明の先行操作は同じIDで確定し、追加編集を保存する', async () => {
  const initial = structuredClone(store.ref.current!);
  mock.api
    .mockRejectedValueOnce(new Error('応答が失われました'))
    .mockResolvedValueOnce({ ...initial, status: 'active' })
    .mockResolvedValueOnce({ saved: true });
  await expect(store.command({ type: 'start' })).rejects.toThrow('応答が失われました');
  store.update((session) => ({ ...session, title: '応答不明の間の編集' }));

  const abort = new AbortController();
  abort.abort();
  await expect(store.command({ type: 'end' }, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(mock.api).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mock.api.mock.calls[1][1].body)).toEqual(
    JSON.parse(mock.api.mock.calls[0][1].body),
  );
  expect(store.ref.current).toMatchObject({ status: 'active', title: '応答不明の間の編集' });
  expect(store.unsaved).toBe(true);
  await store.flush();
  expect(mock.api.mock.lastCall![1].method).toBe('PUT');
  expect(JSON.parse(mock.api.mock.lastCall![1].body)).toMatchObject({
    status: 'active', title: '応答不明の間の編集',
  });
  expect(store.unsaved).toBe(false);
});

it('初回作成後のPUT失敗では会議を作り直さず、同じ認証情報で最新編集を再保存する', async () => {
  mock.api.mockResolvedValueOnce(createSession().settings);
  store = new SessionPersistence(undefined, view);
  await store.load();
  const created = { ...store.ref.current!, shareToken: crypto.randomUUID() };
  mock.api.mockResolvedValueOnce(created).mockRejectedValueOnce(new Error('内容の保存失敗'));
  await expect(store.ensureSaved()).rejects.toThrow('内容の保存失敗');
  expect(store.unsaved).toBe(true);
  store.update((session) => ({ ...session, title: '失敗後の最新編集' }));
  mock.api.mockResolvedValueOnce({ saved: true });
  await store.ensureSaved();
  expect(mock.api.mock.calls.filter(([path]) => path === '/api/sessions')).toHaveLength(1);
  expect(mock.api.mock.lastCall![0]).toBe(`/api/sessions/${created.id}`);
  expect(JSON.parse(mock.api.mock.lastCall![1].body)).toMatchObject({
    title: '失敗後の最新編集', shareToken: created.shareToken,
  });
  expect(store.unsaved).toBe(false);
});

it('ホームの読込だけでは会議を作らず、初回保存は同じIDで再試行する', async () => {
  const defaults = createSession().settings;
  expect(defaults.input).toBe('mixed');
  defaults.language = 'en';
  defaults.input = 'display';
  mock.api.mockResolvedValue(defaults);
  store = new SessionPersistence(undefined, view);
  await Promise.all([store.load(), store.load()]);
  const initial = store.ref.current!;
  expect(initial.settings.language).toBe('en');
  expect(initial.settings.input).toBe('display');
  await store.flush();
  expect(mock.api).toHaveBeenCalledTimes(1);
  expect(store.saved).toBe(false);

  mock.api.mockRejectedValueOnce(new Error('作成応答が失われました'));
  await expect(store.ensureSaved()).rejects.toThrow('作成応答が失われました');
  const created = { ...initial, shareToken: crypto.randomUUID() };
  mock.api.mockResolvedValueOnce(created).mockResolvedValueOnce({ saved: true });
  await store.ensureSaved();
  const creations = mock.api.mock.calls.filter(([path]) => path === '/api/sessions');
  expect(creations).toHaveLength(2);
  expect(creations.map(([, options]) => JSON.parse(options.body).id)).toEqual([
    initial.id,
    initial.id,
  ]);
  expect(store.ref.current?.shareToken).toBe(created.shareToken);
  expect(store.saved).toBe(true);
  expect(store.unsaved).toBe(false);
});

it('初回作成中の編集も次の保存に残す', async () => {
  mock.api.mockResolvedValueOnce(createSession().settings);
  store = new SessionPersistence(undefined, view);
  await store.load();
  const entered = deferred<void>();
  const server = deferred<Session>();
  mock.api.mockImplementationOnce(() => {
    entered.resolve();
    return server.promise;
  });
  mock.api.mockResolvedValue({ saved: true });
  const initial = structuredClone(store.ref.current!);
  const saving = store.ensureSaved();
  await entered.promise;
  store.update((s) => ({ ...s, title: '初回保存中の編集' }));
  server.resolve(initial);
  await saving;
  expect(store.dirty).toBe(true);
  await store.flush();
  expect(JSON.parse(mock.api.mock.lastCall![1].body).title).toBe('初回保存中の編集');
});

it('生成中に資料を削除した場合は遅れた共通結果を反映しない', async () => {
  const document = documentSchema.parse({
    id: crypto.randomUUID(),
    name: '資料.txt',
    kind: 'reference',
    format: 'text',
    size: 10,
    pages: [],
    preparationPending: true,
  });
  store.ref.current!.documents = [document];
  const server = deferred<unknown>();
  const entered = deferred<void>();
  mock.api.mockImplementationOnce(() => {
    entered.resolve();
    return server.promise;
  });
  const preparation = store.prepareDocuments();
  await entered.promise;
  store.update((session) => ({ ...session, documents: [] }));
  server.resolve({ documentIds: [document.id], summary: '遅れた結果', glossary: [] });
  await preparation;
  expect(store.ref.current!.documents).toEqual([]);
  expect(store.ref.current!.documentReference).toEqual({
    documentIds: [],
    summary: '',
    glossary: [],
  });
});

it('翻訳先が未設定の新規会議は読み込み時のアプリ言語で固定する', async () => {
  mock.api.mockResolvedValue(createSession().settings);
  store = new SessionPersistence(undefined, view);
  await store.load('en');
  expect(store.ref.current!.settings.translationLanguage).toBe('en');
  await store.load('zh');
  expect(store.ref.current!.settings.translationLanguage).toBe('en');
});

it('新規会議は前回保存した翻訳先をアプリ言語より優先する', async () => {
  mock.api.mockResolvedValue({ ...createSession().settings, translationLanguage: 'zh' });
  store = new SessionPersistence(undefined, view);
  await store.load('en');
  expect(store.ref.current!.settings.translationLanguage).toBe('zh');
});

it('旧会議の未指定の翻訳先は読み込み時に固定し、指定済みは維持する', async () => {
  for (const translationLanguage of [null, 'zh'] as const) {
    const session = createSession();
    session.settings.translationLanguage = translationLanguage;
    mock.api.mockResolvedValue(session);
    store = new SessionPersistence(session.id, view);
    await store.load('en');
    expect(store.ref.current!.settings.translationLanguage).toBe(translationLanguage ?? 'en');
  }
});
