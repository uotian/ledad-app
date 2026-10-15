import { api } from '@/lib/api';

export function pollUsage<T>(
  path: string,
  onValue: (value: T) => boolean | void,
  onError: () => void,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    let repeat = true;
    try {
      const value = await api<T>(path, { signal: controller.signal });
      if (!controller.signal.aborted) repeat = onValue(value) !== false;
    } catch {
      if (!controller.signal.aborted) onError();
    } finally {
      if (!controller.signal.aborted && repeat) timer = setTimeout(refresh, 5000);
    }
  }
  void refresh();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
