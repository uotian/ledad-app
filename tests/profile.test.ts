import { expect, it } from 'vitest';
import { emptyProfile, profileSchema } from '@/components/settings/profile/profile';

it('旧設定の名前と呼ばれ方を失わず一つにまとめ、再読込で重複させない', () => {
  const merged = profileSchema.parse({
    name: ' 内藤 義彦 ',
    aliases: ' 内藤さん、Naito\nYoshihiko ',
  });
  expect(merged).toEqual({ name: '内藤 義彦、内藤さん、Naito、Yoshihiko', aliases: '' });
  expect(profileSchema.parse(merged)).toEqual(merged);
  expect(profileSchema.parse({ name: '', aliases: 'Naito' })).toEqual({
    name: 'Naito',
    aliases: '',
  });
  expect(profileSchema.parse({ name: '内藤さん、Naito' }).name).toBe('内藤さん、Naito');
  expect(profileSchema.parse(emptyProfile)).toEqual(emptyProfile);
  expect(
    profileSchema.parse({ name: 'あ'.repeat(100), aliases: 'い'.repeat(500) }).name,
  ).toHaveLength(601);
  expect(profileSchema.safeParse({ name: 'あ'.repeat(602) }).success).toBe(false);
});
