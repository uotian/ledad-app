import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ChatReplyContent from '@/components/meeting/chat/ChatReplyContent';

it('回答に含まれるHTMLや画像を実行・読み込みせず、文章として表示する', () => {
  const html = renderToStaticMarkup(
    createElement(ChatReplyContent, {
      text: '回答の本文です。\n\n<script>alert(1)</script>\n\n<img src="https://example.com/track">\n\n![画像](https://example.com/track)\n\n[リンク](javascript:alert(1))',
    }),
  );
  expect(html).toContain('回答の本文です。');
  expect(html).toContain('リンク');
  expect(html).not.toMatch(/<script|<img|<a\b|javascript:|https:\/\/example/);
});

it('保存済みのプレーンテキストも内容を変えずに段落として表示する', () => {
  const html = renderToStaticMarkup(
    createElement(ChatReplyContent, { text: '以前の回答です。\n\n補足の説明です。' }),
  );
  expect(html).toContain('<p>以前の回答です。</p>');
  expect(html).toContain('<p>補足の説明です。</p>');
});
