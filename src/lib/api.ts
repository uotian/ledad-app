import { serviceFetch } from './desktop';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options?: RequestInit,
  onText?: (text: string) => void,
): Promise<T> {
  const response = await serviceFetch(
    path,
    {
      ...options,
      headers: {
        ...(options?.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options?.headers,
      },
    },
    onText,
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      error?.error || `処理を完了できませんでした（${response.status}）。もう一度お試しください。`,
      response.status,
    );
  }
  return response.json();
}
