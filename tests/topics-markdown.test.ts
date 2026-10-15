import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Topics from '@/components/meeting/analyze/Topics';

function render(summary: string) {
  return renderToStaticMarkup(
    createElement(Topics, {
      topics: [{ id: 'topic', title: '検討内容', summary }],
    }),
  );
}

it('要点の小見出し・入れ子の箇条書き・表を表示する', () => {
  const html = render('## 比較\n\n- 案A\n  - 補足\n\n| 案 | 費用 |\n| --- | --- |\n| A | 100円 |');
  expect(html).toContain('<h4>比較</h4>');
  expect(html.match(/<ul>/g)).toHaveLength(2);
  expect(html).toContain('<table>');
  expect(html).toContain('<th>費用</th>');
  expect(html).toContain('<td>100円</td>');
});

it('旧プレーンテキストを残し、HTMLや外部画像を表示しない', () => {
  const html = render(
    '・以前の要点\n・補足\n\n<script>alert(1)</script>\n\n![画像](https://example.com/track)\n\n[参照](https://example.com)',
  );
  expect(html).toContain('・以前の要点\n・補足');
  expect(html).toContain('参照');
  expect(html).not.toMatch(/<script|<img|<a\b|https:\/\/example/);
});

it('Topicの根拠発言から経過時間を表示し、時刻不明なら省略する', () => {
  const timestamp = new Date(Date.now() - 180_000).toISOString();
  const html = renderToStaticMarkup(
    createElement(Topics, {
      topics: [{ id: 'topic', title: '検討内容', summary: '概要' }],
      timestamps: { topic: timestamp },
    }),
  );
  expect(html).toContain(`dateTime="${timestamp}"`);
  expect(html).toContain('3分前');
  expect(render('概要')).not.toContain('<time');
});
