export function usageTextBlocks(value: unknown, path = ''): { path: string; text: string }[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => usageTextBlocks(item, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const nextPath = path ? `${path}.${key}` : key;
    return typeof item === 'string' && (key === 'text' || key === 'instructions')
      ? [{ path: nextPath, text: item }]
      : usageTextBlocks(item, nextPath);
  });
}
