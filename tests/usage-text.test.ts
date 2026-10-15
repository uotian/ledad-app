import { expect, test } from 'vitest';
import { usageTextBlocks } from '../src/components/meeting/header/usage-text';

test('API本文のテキストだけを順番に取り出す', () => {
  expect(
    usageTextBlocks({
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: '一行目\n二行目' }] },
        { role: 'user', content: [{ type: 'input_text', text: '質問' }] },
      ],
      prompt_cache_options: { mode: 'explicit' },
    }),
  ).toEqual([
    { path: 'input[0].content[0].text', text: '一行目\n二行目' },
    { path: 'input[1].content[0].text', text: '質問' },
  ]);
  expect(usageTextBlocks({ instructions: '指示', input: '質問' })).toEqual([
    { path: 'instructions', text: '指示' },
  ]);
});
