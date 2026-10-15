export function formatTimeAgo(timestamp: number, now: number, locale: string) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 60
      ? [seconds, 'second']
      : seconds < 3600
        ? [Math.floor(seconds / 60), 'minute']
        : seconds < 86400
          ? [Math.floor(seconds / 3600), 'hour']
          : [Math.floor(seconds / 86400), 'day'];
  return new Intl.RelativeTimeFormat(locale, { style: 'narrow' }).format(-value, unit);
}
