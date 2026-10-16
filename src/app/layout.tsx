import type { Metadata } from 'next';
import './globals.css';
import TextSizeProvider from '@/components/settings/TextSizeProvider';
import LanguageProvider from '@/components/settings/LanguageProvider';
import ThemeInitializer from '@/components/settings/ThemeInitializer';
export const metadata: Metadata = {
  title: 'ledad — あなたの言葉を、あなたのペースで。',
  description: '会議の理解と発言を支える、あなたのための会議アシスタント。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="light" suppressHydrationWarning>
      <body>
        <ThemeInitializer />
        <LanguageProvider>
          <TextSizeProvider>{children}</TextSizeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
