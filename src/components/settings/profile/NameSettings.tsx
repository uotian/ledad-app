'use client';
import { useState } from 'react';
import { useI18n } from '../LanguageProvider';
import { useProfile, saveProfile } from './useProfile';
import styles from './profile.module.css';

export default function NameSettings() {
  const { t } = useI18n();
  const saved = useProfile();
  const [draft, setDraft] = useState<typeof saved | null>(null);
  const [error, setError] = useState(false);
  const value = draft || saved;
  function persist() {
    if (!draft) return;
    try {
      saveProfile(draft);
      setDraft(null);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <section className={styles.settings} aria-label={t('あなたの名前・呼ばれ方')}>
      <label className="field">
        {t('あなたの名前・呼ばれ方')}
        <input
          maxLength={601}
          value={value.name}
          placeholder={t('例：内藤芳彦 内藤さん Naito Yoshihiko')}
          aria-describedby="profile-help"
          onChange={(e) => setDraft({ ...value, name: e.target.value })}
          onBlur={persist}
        />
      </label>
      <p id="profile-help" className="field-help">
        {t(
          '名前や呼ばれ方をスペース区切りで入力してください。言及の検出に使います。設定はこの端末に保存され、会話分析や音声認識のときにAIへ送られます。',
        )}
      </p>
      {error && <p role="alert">{t('名前を保存できませんでした。')}</p>}
    </section>
  );
}
