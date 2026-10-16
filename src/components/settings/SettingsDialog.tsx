'use client';
import { useDialogDismiss } from '@/hooks/useDialogDismiss';
import TextSizeSettings from './TextSizeSettings';
import ThemeSettings from './ThemeSettings';
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
  baseUrl: string;
  aiMode: 'openai' | 'gemini';
  openai: boolean;
  gemini: boolean;
  liveProvider: 'gemini' | 'apple' | 'openai';
  liveModels: { openai: string; gemini: string; apple: string };
  refinementProvider: 'openai' | 'gemini';
  refinementModels: { openai: string; gemini: string };
  speechModels: { openai: string; gemini: string };
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
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    dialog.current?.showModal();
    api<Config>('/api/config')
      .then((value) => {
        setConfig(value);
        setBaseUrl(value.baseUrl);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await desktopInvoke('save_keys', {
        openai,
        gemini: config?.aiMode === 'gemini' ? gemini : '',
      });
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
  async function saveConnection() {
    if (!window.dispatchEvent(new Event('ledad-before-connection-change', { cancelable: true }))) {
      setError(t('聞き取り・読み上げを停止してから接続先を変更してください。'));
      return;
    }
    setSavingSetting(true);
    setError('');
    try {
      const next = await api<Config>('/api/connection-settings', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl }),
      });
      setConfig(next);
      setBaseUrl(next.baseUrl);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('AI設定を保存できませんでした。'));
    } finally {
      setSavingSetting(false);
    }
  }
  async function changeSetting(path: string, value: object) {
    setSavingSetting(true);
    setError('');
    try {
      setConfig(await api<Config>(path, { method: 'PUT', body: JSON.stringify(value) }));
      onSaved?.();
    } catch {
      setError(t('AI設定を保存できませんでした。'));
    } finally {
      setSavingSetting(false);
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
          {t('AI')}
        </button>
      </div>
      {tab === 'general' ? (
        <div className="settings-general">
          <NameSettings />
          <AnalyzeIntervalSettings />
          <LanguageSettings />
          <ThemeSettings />
          <TextSizeSettings />
        </div>
      ) : (
        <>
          <ErrorBanner message={error} />
          <div className="field">
            <label htmlFor="base-url">{t('接続先URL（base_url）')}</label>
            <div className="settings-connection">
              <input
                id="base-url"
                type="url"
                value={baseUrl}
                maxLength={2048}
                placeholder={t('空欄：OpenAI公式')}
                disabled={!config || savingSetting || busy}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <Button
                small
                onClick={saveConnection}
                disabled={!config || savingSetting || busy || baseUrl === config.baseUrl}
              >
                {t('接続先を保存')}
              </Button>
            </div>
          </div>
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
          {config?.aiMode === 'gemini' && (
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
          )}
          <div className="settings-models">
            <div className="settings-models-heading">
              <strong>{t('使用するモデル')}</strong>
              <label>
                <input
                  type="checkbox"
                  checked={config?.aiMode === 'gemini'}
                  disabled={!config || !!config.baseUrl || savingSetting || busy}
                  onChange={(e) =>
                    void changeSetting('/api/ai-settings', {
                      mode: e.target.checked ? 'gemini' : 'openai',
                    })
                  }
                />
                {t('Geminiも使う')}
              </label>
            </div>
            <dl>
              <dt id="live-provider-label">{t('聞き取り（Live）')}</dt>
              <dd>
                {config?.baseUrl ? (
                  <span>Apple SpeechTranscriber</span>
                ) : (
                  <select
                    aria-labelledby="live-provider-label"
                    value={config?.liveProvider ?? 'openai'}
                    disabled={!config || savingSetting || busy}
                    onChange={(event) =>
                      void changeSetting('/api/live-settings', { provider: event.target.value })
                    }
                  >
                    <option value="openai">{config?.liveModels.openai || t('確認中')}</option>
                    {config?.aiMode === 'gemini' && (
                      <option value="gemini">{config.liveModels.gemini}</option>
                    )}
                    <option value="apple" disabled={!isDesktop()}>
                      {config?.liveModels.apple || 'Apple SpeechTranscriber'}
                    </option>
                  </select>
                )}
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
                {config?.aiMode !== 'gemini' ? (
                  <span>{config?.refinementModels.openai || t('確認中')}</span>
                ) : (
                  <select
                    aria-labelledby="refinement-provider-label"
                    value={config?.refinementProvider ?? 'openai'}
                    disabled={!config || savingSetting || busy}
                    onChange={(event) =>
                      void changeSetting('/api/config', { provider: event.target.value })
                    }
                  >
                    <option value="openai">{config?.refinementModels.openai || t('確認中')}</option>
                    <option value="gemini">{config?.refinementModels.gemini || t('確認中')}</option>
                  </select>
                )}
              </dd>
              <dt>{t('翻訳・候補・要約')}</dt>
              <dd>{config?.models.generation || t('確認中')}</dd>
              <dt>{t('AIへの相談')}</dt>
              <dd>{config?.models.consultation || t('確認中')}</dd>
              {config && (
                <VoiceSettings
                  key={config.aiMode}
                  mode={config.aiMode}
                  models={config.speechModels}
                  disabled={savingSetting || busy}
                />
              )}
            </dl>
          </div>
          <Button
            variant="primary"
            className="full-width"
            disabled={
              busy ||
              savingSetting ||
              (!openai.trim() && !(config?.aiMode === 'gemini' && gemini.trim())) ||
              !isDesktop()
            }
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
