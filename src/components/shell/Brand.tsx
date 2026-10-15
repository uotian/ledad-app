import { useI18n } from '@/components/settings/LanguageProvider';
import HomeLink from './HomeLink';
import BrandMark from './BrandMark';
export default function Brand({ light = false, onHome }: { light?: boolean; onHome?: () => void }) {
  const { t } = useI18n();
  return (
    <HomeLink
      onHome={onHome}
      className={`brand ${light ? 'brand-light' : ''}`}
      aria-label={t('ledad ホーム')}
      title={t('ledad ホーム')}
    >
      <BrandMark />
      <span>
        ledad<span className="brand-dot">.</span>
      </span>
    </HomeLink>
  );
}
