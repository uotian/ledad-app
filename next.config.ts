import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // 左下の設定ボタンに開発用インジケーターを重ねない。
  devIndicators: false,
};
export default config;
