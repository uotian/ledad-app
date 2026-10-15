'use client';
import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import TextSizeSettings from './TextSizeSettings';
import VoiceSettings from './VoiceSettings';
import AnalyzeIntervalSettings from './AnalyzeIntervalSettings';
import NameSettings from './profile/NameSettings';
import LanguageSettings from './LanguageSettings';
import { useI18n } from '@/components/settings/LanguageProvider';

import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { desktopInvoke, isDesktop } from '@/lib/desktop';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import ErrorBanner from '@/components/ui/ErrorBanner';
type Config = {
  openai: boolean;
  gemini: boolean;
  liveProvider: 'gemini' | 'apple';
  liveModels: { gemini: string; apple: string };
  refinementProvider: 'openai' | 'gemini';
  refinementModels: { openai: string; gemini: string };
  models: {
    generation: string;
    transcription: string;
    refinement: string;
    consultation: string;
    speech: string;
  };
};
export default function SettingsDialog({
  onClose,
  onSaved,
  initialTab = 'general',
}: {
  onClose: () => void;
  onSaved?: () => void;
  initialTab?: 'general' | 'keys';
}) {
  const dismiss = useDialogDismiss();
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [openai, setOpenai] = useState('');
  const [gemini, setGemini] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingLiveProvider, setSavingLiveProvider] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    dialog.current?.showModal();
    api<Config>('/api/config')
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await desktopInvoke('save_keys', { openai, gemini });
      setOpenai('');
      setGemini('');
      onSaved?.();
      onClose();
    } catch {
      setError(t('キーチェーンへ保存できませんでした。Macのアクセス許可を確認してください。'));
    } finally {
      setBusy(false);
    }
  }
  async function changeRefinementProvider(provider: Config['refinementProvider']) {
    setSavingProvider(true);
    setError('');
    try {
      setConfig(
        await api<Config>('/api/config', {
          method: 'PUT',
          body: JSON.stringify({ provider }),
        }),
      );
    } catch {
      setError(t('Fixedの文字起こし先を保存できませんでした。'));
    } finally {
      setSavingProvider(false);
    }
  }
  async function changeLiveProvider(provider: Config['liveProvider']) {
    setSavingLiveProvider(true);
    setError('');
    try {
      setConfig(
        await api<Config>('/api/live-settings', {
          method: 'PUT',
          body: JSON.stringify({ provider }),
        }),
      );
    } catch {
      setError(t('Liveの文字起こし先を保存できませんでした。'));
    } finally {
      setSavingLiveProvider(false);
    }
  }
  return (
    <dialog
      {...dismiss}
      className="settings-dialog"
      ref={dialog}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="section-heading">
        <h2>
          <Settings size={18} aria-hidden="true" />
          {t('設定')}
        </h2>
        <button className="icon-button" onClick={onClose} aria-label={t('設定を閉じる')}>
          <X size={17} />
        </button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label={t('設定の種類')}>
        <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>
          {t('一般')}
        </button>
        <button role="tab" aria-selected={tab === 'keys'} onClick={() => setTab('keys')}>
          {t('APIキー')}
        </button>
      </div>
      {tab === 'general' ? (
        <div className="settings-general">
          <NameSettings />
          <VoiceSettings />
          <AnalyzeIntervalSettings />
          <LanguageSettings />
          <TextSizeSettings />
        </div>
      ) : (
        <>
          <h3 className="settings-section-title">{t('APIキー')}</h3>
          <ErrorBanner message={error} />
          <p className="settings-description">
            {t('APIキーはMacのキーチェーンに保存します。登録済みのキーは表示しません。')}
          </p>
          <label className="field">
            {t('OpenAI APIキー')}{' '}
            <span className="settings-key-status">
              {config?.openai ? t('設定済み') : t('未設定')}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={openai}
              onChange={(e) => setOpenai(e.target.value)}
              placeholder={config?.openai ? t('変更する場合だけ入力') : t('APIキーを入力')}
            />
          </label>
          <label className="field">
            {t('Gemini APIキー')}{' '}
            <span className="settings-key-status">
              {config?.gemini ? t('設定済み') : t('未設定')}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={gemini}
              onChange={(e) => setGemini(e.target.value)}
              placeholder={config?.gemini ? t('変更する場合だけ入力') : t('APIキーを入力')}
            />
          </label>
          <div className="settings-models">
            <strong>{t('使用するモデル')}</strong>
            <dl>
              <dt id="live-provider-label">{t('聞き取り（Live）')}</dt>
              <dd>
                <select
                  aria-labelledby="live-provider-label"
                  value={config?.liveProvider ?? 'gemini'}
                  disabled={!config || savingLiveProvider}
                  onChange={(event) =>
                    void changeLiveProvider(event.target.value as Config['liveProvider'])
                  }
                >
                  <option value="gemini">{config?.liveModels.gemini || t('確認中')}</option>
                  <option value="apple" disabled={!isDesktop()}>
                    {config?.liveModels.apple || 'Apple SpeechTranscriber'}
                  </option>
                </select>
                {config?.liveProvider === 'apple' && (
                  <p className="field-help">
                    {t(
                      'macOS 26以降でMac内で文字起こしします。初回は会議の言語モデルをダウンロードします。',
                    )}
                  </p>
                )}
              </dd>
              <dt id="refinement-provider-label">{t('聞き取り（Fixed）')}</dt>
              <dd>
                <select
                  aria-labelledby="refinement-provider-label"
                  value={config?.refinementProvider ?? 'openai'}
                  disabled={!config || savingProvider}
                  onChange={(event) =>
                    void changeRefinementProvider(
                      event.target.value as Config['refinementProvider'],
                    )
                  }
                >
                  <option value="openai">{config?.refinementModels.openai || t('確認中')}</option>
                  <option value="gemini">{config?.refinementModels.gemini || t('確認中')}</option>
                </select>
              </dd>
              <dt>{t('翻訳・候補・要約')}</dt>
              <dd>{config?.models.generation || t('確認中')}</dd>
              <dt>{t('AIへの相談')}</dt>
              <dd>{config?.models.consultation || t('確認中')}</dd>
              <dt>{t('音声出力')}</dt>
              <dd>{config?.models.speech || t('確認中')}</dd>
            </dl>
          </div>
          <Button
            variant="primary"
            className="full-width"
            disabled={busy || (!openai.trim() && !gemini.trim()) || !isDesktop()}
            onClick={save}
          >
            {busy ? t('保存中…') : t('キーチェーンに保存')}
          </Button>
          {!isDesktop() && (
            <p className="field-help">
              {t('ブラウザでのUI検証中は、env.localで設定してください。')}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
