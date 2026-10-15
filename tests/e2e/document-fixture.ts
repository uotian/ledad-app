import type { Route } from '@playwright/test';
import type { Session } from '../../src/lib/session/schema';

// Browser tests exercise registration/persistence without paid external AI calls.
export async function uploadedDocument(route: Route) {
  const name =
    route
      .request()
      .postData()
      ?.match(/filename="([^"]+)"/)?.[1] ?? '資料.txt';
  if (name.endsWith('.docx')) {
    await route.fulfill({
      status: 400,
      json: { error: 'PDF・PPT・画像・TXT・Markdownに対応しています。' },
    });
    return;
  }
  await route.fulfill({
    json: {
      document: {
        id: crypto.randomUUID(),
        name,
        kind: 'reference',
        format: name.endsWith('.png') ? 'image' : 'text',
        size: 100,
        pages: [],
        preparationPending: true,
      },
      warning: '',
    },
  });
}

export async function preparedDocument(route: Route) {
  const path = route.request().url().replace(':4319', ':4320').split('/document-reference')[0];
  const request = route.request().frame().page().request;
  const session: Session = await (await request.get(path)).json();
  const reference = {
    documentIds: session.documents.map((d) => d.id),
    summary: session.documents.length ? '## 会議共通の参照文\n会議の参考資料です。' : '',
    glossary: session.documents.length ? ['Ledad'] : [],
  };
  session.documents = session.documents.map((d) => ({ ...d, preparationPending: false }));
  session.documentReference = reference;
  const saved = await request.put(path, { data: session });
  if (!saved.ok()) throw new Error('Could not save prepared fixture');
  await route.fulfill({ json: reference });
}
