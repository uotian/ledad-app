'use client';
import { useState } from 'react';
import type { Settings } from '@/lib/session/schema';
import { useI18n } from './LanguageProvider';
import { readVoice, saveVoice, rememberedVoice, voiceProvider, type AIMode } from './voice';
import ErrorBanner from '@/components/ui/ErrorBanner';

export default function VoiceSettings({
  models,
  mode,
  disabled,
}: {
  models?: { openai: string; gemini: string };
  mode: AIMode;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [{ voice, error }, setState] = useState<{ voice: Settings['voice'] | null; error: string }>(
    () => {
      try {
        return { voice: readVoice(mode), error: '' };
      } catch {
        return { voice: null, error: '声の設定を読み込めません。' };
      }
    },
  );
  function change(value: Settings['voice']) {
    try {
      saveVoice(value, mode);
      setState({ voice: value, error: '' });
    } catch {
      setState((previous) => ({ ...previous, error: '声の設定を保存できませんでした。' }));
    }
  }
  const provider = voice ? voiceProvider(voice) : mode;
  return (
    <>
      <dt id="speech-provider-label">{t('音声出力')}</dt>
      <dd>
        {mode === 'openai' ? (
          <span>{models?.openai || t('確認中')}</span>
        ) : (
          <select
            aria-labelledby="speech-provider-label"
            value={provider}
            disabled={disabled || !voice || !models}
            onChange={(e) => {
              try {
                change(rememberedVoice(e.target.value as AIMode));
              } catch {
                setState((previous) => ({ ...previous, error: '声の設定を読み込めません。' }));
              }
            }}
          >
            <option value="openai">{models?.openai || t('確認中')}</option>
            <option value="gemini">{models?.gemini || t('確認中')}</option>
          </select>
        )}
      </dd>
      <dt id="speech-voice-label">{t('声の種類')}</dt>
      <dd>
        <select
          value={voice ?? 'Kore'}
          disabled={disabled || !voice}
          aria-labelledby="speech-voice-label"
          onChange={(e) => change(e.target.value as Settings['voice'])}
        >
          {provider === 'openai' ? (
            <>
              <option value="marin">Marin</option>
              <option value="cedar">Cedar</option>
            </>
          ) : (
            <>
              <option value="Kore">{t('Kore · 落ち着いた声')}</option>
              <option value="Aoede">{t('Aoede · 柔らかな声')}</option>
              <option value="Puck">{t('Puck · 明るい声')}</option>
              <option value="Charon">{t('Charon · 明瞭な声')}</option>
            </>
          )}
        </select>
        <ErrorBanner message={t(error)} />
      </dd>
    </>
  );
}
