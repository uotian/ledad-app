'use client';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import SettingsDialog from './SettingsDialog';
export default function SettingsButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="nav-item settings-button"
        onClick={() => setOpen(true)}
        aria-label={t('設定')}
        title={t('設定')}
      >
        <Settings size={20} />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
