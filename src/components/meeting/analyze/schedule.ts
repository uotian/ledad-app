export function startAnalyzeSchedule(
  refresh: () => Promise<void | 'sent' | 'retry'>,
  intervalMs: () => number = () => 0,
  onWaiting: (until: number | null) => void = () => {},
) {
  let running = false;
  let stopped = false;
  let requested = false;
  let retried = false;
  let intervalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCompletedAt = -Infinity;

  async function run(immediate = false) {
    if (running || stopped || !requested) return;
    if (intervalTimer !== null) clearTimeout(intervalTimer);
    const wait = immediate ? 0 : lastCompletedAt + intervalMs() - Date.now();
    if (wait > 0) {
      onWaiting(Date.now() + wait);
      intervalTimer = setTimeout(() => {
        intervalTimer = null;
        void run();
      }, wait);
      return;
    }
    intervalTimer = null;
    onWaiting(null);
    running = true;
    requested = false;
    let retry = false;
    try {
      const result = await refresh();
      retry = result === 'retry';
      if (result === 'sent' || retry) lastCompletedAt = Date.now();
    } catch {
      retry = true;
      lastCompletedAt = Date.now();
    } finally {
      running = false;
      if (!stopped) {
        if (retry && !retried) {
          retried = true;
          requested = true;
          void run(true);
        } else {
          if (!retry) retried = false;
          void run();
        }
      }
    }
  }

  return {
    request() {
      if (stopped) return;
      retried = false;
      requested = true;
      void run();
    },
    stop() {
      stopped = true;
      onWaiting(null);
      if (intervalTimer !== null) clearTimeout(intervalTimer);
    },
  };
}
