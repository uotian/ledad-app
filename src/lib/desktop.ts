import { decodeBase64, encodeBase64 } from './base64';

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
export async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export async function serviceFetch(
  path: string,
  options?: RequestInit,
  onText?: (text: string) => void,
): Promise<Response> {
  if (!isDesktop()) {
    const response = await fetch(
      `http://127.0.0.1:4319${path}${onText ? '?stream=true' : ''}`,
      options,
    );
    if (!onText || !response.ok) return response;
    return readServiceStream(response, onText, options?.signal);
  }
  const id = crypto.randomUUID();
  const input: ServiceRequest = { id, path, method: options?.method || 'GET', stream: !!onText };
  if (options?.body instanceof FormData) {
    const file = options.body.get('file') as File;
    input.file = {
      name: file.name,
      data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
      kind: String(options.body.get('kind')),
    };
  } else if (options?.body) input.body = String(options.body);
  if (options?.signal?.aborted) throw new DOMException('取消', 'AbortError');
  const cancel = () => {
    // 通知が届かなくても、呼び出し元は下のsignal判定で取消を受け取る。
    void desktopInvoke('service_cancel', { id }).catch(() => {});
  };
  options?.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const { Channel } = await import('@tauri-apps/api/core');
    if (options?.signal?.aborted) throw new DOMException('取消', 'AbortError');
    const channel = new Channel<string>();
    channel.onmessage = (text) => {
      if (!options?.signal?.aborted) onText?.(text);
    };
    const result = await desktopInvoke<ServiceResponse>('service_request', {
      input,
      onText: channel,
    });
    if (options?.signal?.aborted) throw new DOMException('取消', 'AbortError');
    const bytes = decodeBase64(result.body);
    return new Response(bytes, {
      status: result.status,
      headers: { 'Content-Type': result.contentType },
    });
  } finally {
    options?.signal?.removeEventListener('abort', cancel);
  }
}
export type ServiceRequest = {
  id: string;
  path: string;
  method: string;
  body?: string;
  stream?: boolean;
  file?: { name: string; data: string; kind: string };
};
export type ServiceResponse = { id: string; status: number; contentType: string; body: string };

export async function readServiceStream(
  response: Response,
  onText: (text: string) => void,
  signal?: AbortSignal | null,
): Promise<Response> {
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson'))
    throw new Error('回答のストリームを開始できませんでした。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException('取消', 'AbortError');
      if (done) throw new Error('回答が途中で切れました。再試行してください。');
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const event = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (typeof event.text === 'string') onText(event.text);
        else if (typeof event.status === 'number' && typeof event.body === 'string') {
          return new Response(decodeBase64(event.body), {
            status: event.status,
            headers: { 'Content-Type': event.contentType },
          });
        } else throw new Error('回答のストリームが不正です。');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
