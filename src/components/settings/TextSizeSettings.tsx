'use client';
import { useI18n } from './LanguageProvider';
import { useTextSize } from './TextSizeProvider';
export default function TextSizeSettings() {
  const { t } = useI18n();
  const { size, setSize } = useTextSize();
  return (
    <fieldset className="appearance-settings">
      <legend>{t('文字サイズ')}</legend>
      <div className="theme-options">
        {(['S', 'M', 'L'] as const).map((value) => (
          <label key={value} className={size === value ? 'theme-option selected' : 'theme-option'}>
            <input
              type="radio"
              name="text-size"
              value={value}
              checked={size === value}
              onChange={() => setSize(value)}
            />
            <span>{value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
