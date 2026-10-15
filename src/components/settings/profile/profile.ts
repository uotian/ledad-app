import { z } from 'zod';

export const profileSchema = z
  .object({
    name: z.string().trim().max(601),
    aliases: z.string().trim().max(500).default(''),
  })
  // 旧設定を一つの欄へ引き継ぎます。APIのprofileKeyとの互換性のためaliasesは空で残します。
  .transform(({ name, aliases }) => ({
    name: [name, aliases]
      .filter(Boolean)
      .join('、')
      .replace(/[\r\n]+/g, '、'),
    aliases: '',
  }))
  .pipe(z.object({ name: z.string().max(601), aliases: z.literal('') }));
export type Profile = z.infer<typeof profileSchema>;
export const emptyProfile: Profile = { name: '', aliases: '' };
export const profileStorageKey = 'ledad.profile.v1';
export const profileChanged = 'ledad-profile-changed';
