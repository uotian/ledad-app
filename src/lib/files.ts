import { isDesktop } from './desktop';
export async function saveMarkdownFile(text: string, name: string) {
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: name,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (path) await writeTextFile(path, text);
    return;
  }
  const url = URL.createObjectURL(
    new Blob([text], {
      type: 'text/markdown;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
