'use client';
import { useState } from 'react';
import { readTheme, saveTheme } from '@/lib/theme';
import { useI18n } from './LanguageProvider';

export default function ThemeSettings() {
  const { t } = useI18n();
  const [theme, setTheme] = useState(readTheme);
  return (
    <fieldset className="appearance-settings">
      <legend>{t('外観')}</legend>
      <div className="theme-options">
        {(['light', 'dark', 'system'] as const).map((value) => (
          <label key={value} className={theme === value ? 'theme-option selected' : 'theme-option'}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => {
                saveTheme(value);
                setTheme(value);
              }}
            />
            <span>{t({ light: 'ライト', dark: 'ダーク', system: 'システム' }[value])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
