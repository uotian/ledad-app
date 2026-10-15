import { useI18n } from '@/components/settings/LanguageProvider';
import { useEffect, useRef } from 'react';

const profile = [0.5, 0.8, 1, 0.8, 0.5];
const delays = [3, 1, 0, 2, 4];

export default function InputLevelMeter({ level, active }: { level: number; active: boolean }) {
  const { t } = useI18n();
  const bars = useRef<(HTMLElement | null)[]>([]);
  const history = useRef([0, 0, 0, 0, 0]);
  const value = active && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  useEffect(() => {
    // 実際の音量を少しずつずらして表示し、声の強弱が中央から外へ伝わる波形にする。
    function sample() {
      history.current = active ? [value, ...history.current.slice(0, 4)] : [0, 0, 0, 0, 0];
      bars.current.forEach((bar, index) => {
        if (!bar) return;
        const strength = Math.min(1, Math.sqrt(history.current[delays[index]]) * 2);
        const height = active ? 3 + (5 + 18 * strength) * profile[index] : 3;
        bar.style.transform = `scaleY(${height / 26})`;
      });
    }
    sample();
    if (!active) return;
    // 音量が変わらなくなっても、遅れているバーを現在の値まで追いつかせる。
    const timers = [1, 2, 3, 4].map((step) => setTimeout(sample, step * 60));
    return () => timers.forEach(clearTimeout);
  }, [value, active]);
  return (
    <span
      className="input-meter"
      data-active={active}
      role="meter"
      aria-label={t('入力音量')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      {profile.map((_, index) => (
        <i
          key={index}
          ref={(element) => {
            bars.current[index] = element;
          }}
        />
      ))}
    </span>
  );
}
