import { useEffect, useState } from 'react';
import { useI18n } from '@/components/settings/LanguageProvider';
import { pollUsage } from '@/lib/usage/poll';
import type { MeetingCost, ProviderCost } from '@/lib/usage/cost';
import UsageDialog from './UsageDialog';

export default function MeetingUsageCost({
  sessionId,
  onError,
}: {
  sessionId: string;
  onError: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const [cost, setCost] = useState<MeetingCost | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      pollUsage<MeetingCost>(
        `/api/sessions/${sessionId}/cost`,
        (next) => {
          setCost(next);
          setUnavailable(false);
        },
        () => setUnavailable(true),
      ),
    [sessionId],
  );

  const format = (value?: ProviderCost) => {
    if (!value || value.yen === null) return '—';
    const amount =
      value.yen > 0 && value.yen < 0.01
        ? '<0.01'
        : value.yen.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return t('{amount}円', { amount });
  };
  const description = [
    t('API利用料金の概算です。税・無料枠・割引は含みません。'),
    cost?.pricing
      ? t('単価確認日：{date}。1ドル＝{rate}円（{rateDate}の参考レート）。', {
          date: cost.pricing.checkedOn,
          rate: cost.pricing.usdToJpy,
          rateDate: cost.pricing.exchangeRateDate,
        })
      : t('この会議の単価記録を取得できていません。'),
    t('聞き取りは送信音声の長さと標準的な文字量から見積もります。'),
    unavailable ? t('更新できませんでした。前回取得した金額を表示しています。') : '',
  ]
    .filter(Boolean)
    .join('\n');

  const amount = format(
    cost
      ? {
          yen:
            cost.openai.yen === null || cost.gemini.yen === null
              ? null
              : cost.openai.yen + cost.gemini.yen,
          incomplete: cost.openai.incomplete || cost.gemini.incomplete,
        }
      : undefined,
  );
  const label = t('API履歴を開く');
  return (
    <>
      <span className="meeting-usage-cost">
        <button
          type="button"
          className="provider-cost"
          aria-haspopup="dialog"
          title={`${label}\n${description}`}
          aria-label={`${label} · ${amount}`}
          onClick={() => setOpen(true)}
        >
          API {amount}
        </button>
      </span>
      {open && (
        <UsageDialog sessionId={sessionId} onClose={() => setOpen(false)} onError={onError} />
      )}
    </>
  );
}
